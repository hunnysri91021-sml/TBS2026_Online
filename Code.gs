/**
 * ════════════════════════════════════════════════════════════════
 * Temporary Business Suspension (75% Compensation) 2026
 * Google Apps Script — Complete Backend + LINE OA Webhook
 * Version: Safe Group ID Config
 * ────────────────────────────────────────────────────────────────
 * วิธีใช้:
 * 1) เปิด Google Sheet → Extensions → Apps Script
 * 2) วางโค้ดนี้ใน Code.gs
 * 3) Run setupSheets() 1 ครั้งแรก
 * 4) Project Settings → Script properties เพิ่ม:
 *    LINE_CHANNEL_ACCESS_TOKEN = <Channel access token จาก LINE Developers>
 * 5) Deploy → New Deployment → Web App
 *    Execute as: Me | Who has access: Anyone
 * 6) Copy Web App URL ที่ลงท้าย /exec ไปใส่ทั้ง:
 *    - หน้า HTML ช่อง Google Apps Script URL
 *    - LINE Developers → Messaging API → Webhook URL
 * 7) ใน LINE Group พิมพ์: groupid
 *
 * จุดสำคัญ:
 * - AUTO_UPDATE_GROUP = FALSE เป็นค่าเริ่มต้น เพื่อป้องกันระบบย้ายกลุ่มแจ้งเตือนเอง
 * - ถ้า LINE_TO ว่าง ระบบจะบันทึก Group ID ครั้งแรกให้อัตโนมัติ
 * - ถ้า LINE_TO มีค่าแล้ว และ AUTO_UPDATE_GROUP = FALSE ระบบจะไม่เปลี่ยน LINE_TO
 * ════════════════════════════════════════════════════════════════
 */

// ── Sheet Names ──────────────────────────────────────────────
const SHEET_EMP     = 'Employees';
const SHEET_ATT     = 'Attendance';
const SHEET_DAYS    = 'Days';
const SHEET_LOG     = 'Logs';
const SHEET_CFG     = 'Config';
const SHEET_DASH    = 'Report_Dashboard';
const SHEET_MATRIX  = 'Report_Attendance';
const SHEET_DETAIL  = 'Report_Detail';
const SHEET_NOTIFY  = 'Notify_Log';
const SHEET_LINECFG = 'LINE_CONFIG';

// Canonical Employee Master columns (PDPA-safe Google DB)
const EMP_HEADERS = ['EmpID','Name','Role','Group','Division','Section','Dept','Company','Active'];
const ATT_HEADERS = ['Key','EmpID','Name','DateLabel','Status','UpdateBy','UpdateTime','RowIndex','ColIndex'];

// ════════════════════════════════════════════════════════════════
//  ENTRY POINTS
// ════════════════════════════════════════════════════════════════

function doGet(e) {
  const action = ((e && e.parameter && e.parameter.action) || '').trim();

  if (action === 'ping') {
    return out_({ ok: true, app: 'TBS2026', time: new Date() }, e);
  }
  if (action === 'getAll') {
    return out_({ ok: true, attendance: getAttendance_(), days: getDays_(), employees: getEmployees_(), config: getPublicConfig_() }, e);
  }
  if (action === 'validatePin') {
    return validateAdminPin_((e.parameter.pin || ''), e);
  }
  if (action === 'lineConfig') {
    return out_({ ok: true, config: getLineConfig_() }, e);
  }

  return out_({ ok: true, message: 'TBS 2026 API Ready' }, e);
}

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || '{}';
    const data = JSON.parse(raw);

    // LINE OA Webhook: LINE ส่ง payload ที่มี events
    if (data.events) {
      return handleLineWebhook_(data);
    }

    // TBS API
    const action = data.action || '';

    if (action === 'initSheet')             return initSheet_(data);
    if (action === 'syncAll')               return syncAll_(data);
    if (action === 'updateCell')            return updateCell_(data);
    if (action === 'addLog')                return addAuditLog_(data);
    if (action === 'updateStatus')          return updateCell_({
      empId:      data.empId,
      memberName: data.empName,
      dateLabel:  data.date,
      newState:   data.status,
      updateBy:   data.updateBy || 'Employee'
    });
    if (action === 'notify')                return handleNotify_(data);
    if (action === 'createExecutiveReport') return createExecutiveReport_(data);
    if (action === 'testLine')              return testLine_();
    if (action === 'saveAdminPins')         return saveAdminPins_(data);
    if (action === 'saveLineConfig')        return saveLineConfig_(data);
    if (action === 'saveNotifyConfig')      return saveNotifyConfig_(data);
    if (action === 'addOrUpdateEmployee')   return addOrUpdateEmployee_(data);
    if (action === 'deleteEmployee')        return deleteEmployee_(data);

    return json_({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    log_('doPost_error', String(err));
    // LINE Verify ต้องได้ 200 เสมอ
    return text_('OK');
  }
}

// ════════════════════════════════════════════════════════════════
//  SETUP
// ════════════════════════════════════════════════════════════════

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  getOrCreate_(ss, SHEET_EMP,    EMP_HEADERS);
  migrateEmployeeSheet_();
  getOrCreate_(ss, SHEET_DAYS,   ['Date','Label','DayName','Type','Period','Holiday']);
  getOrCreate_(ss, SHEET_ATT,    ATT_HEADERS);
  getOrCreate_(ss, SHEET_LOG,    ['Time','Action','Detail']);
  getOrCreate_(ss, SHEET_NOTIFY, ['Timestamp','Type','EmpID','EmpName','Date','OldState','NewState','UpdateBy','LineResult','EmailResult']);

  const cfg = getOrCreate_(ss, SHEET_CFG, ['Key','Value','Note']);
  ensureCfgDefaults_();
  ensureLineConfigDefaults_();

  styleHeader_(cfg.getRange(1, 1, 1, 3));
  styleHeader_(ss.getSheetByName(SHEET_LINECFG).getRange(1, 1, 1, 3));
  log_('setupSheets', 'completed');

  try {
    SpreadsheetApp.getUi().alert(
      '✓ TBS2026 Setup เสร็จแล้ว!\n\n' +
      'ขั้นตอนถัดไป:\n' +
      '1. Project Settings → Script properties → เพิ่ม:\n' +
      '   LINE_CHANNEL_ACCESS_TOKEN = <token>\n' +
      '2. Deploy → Web App\n' +
      '3. นำ URL /exec ไปใส่ LINE Webhook และหน้า HTML'
    );
  } catch (err) {}
}

function ensureCfgDefaults_() {
  cfgEnsure_('ADMIN_CODE',        '90230',    'รหัส System Admin เดิม / fallback');
  cfgEnsure_('ADMIN_PIN_HR',      'HR2569',   'รหัส Admin HR&GA');
  cfgEnsure_('ADMIN_PIN_OPS',     'OPS2569',  'รหัส Admin Operation');
  cfgEnsure_('ADMIN_PIN_ACC',     'ACC2569',  'รหัส Admin บัญชีและการเงิน');
  cfgEnsure_('ADMIN_PIN_ADM',     '90230',    'รหัส System Admin');
  cfgEnsure_('PERIOD_NAME',       'Temporary Business Suspension (75% Compensation) 2026', 'ชื่อช่วงเวลา');
  cfgEnsure_('DEFAULT_STATUS',    'On',       'สถานะเริ่มต้นสำหรับวันทำงาน');
  cfgEnsure_('LINE_TO',           '',         'Group ID หรือ User ID ปลายทาง สำหรับ LINE OA');
  cfgEnsure_('LINE_ENABLED',      'TRUE',     'TRUE / FALSE');
  cfgEnsure_('AUTO_UPDATE_GROUP', 'FALSE',    'TRUE = อัปเดต LINE_TO ตามกลุ่มล่าสุด, FALSE = ไม่เปลี่ยนอัตโนมัติ');
  cfgEnsure_('LAST_GROUP_ID',     '',         'Group ID ล่าสุดที่ระบบพบ');
  cfgEnsure_('LAST_USER_ID',      '',         'User ID ล่าสุดที่ระบบพบ');
  cfgEnsure_('EMAIL_TO',          '',         'อีเมลปลายทาง คั่นด้วยจุลภาค');
  cfgEnsure_('EMAIL_CC',          '',         'อีเมล CC');
  cfgEnsure_('EMAIL_ENABLED',     'FALSE',    'เปิด/ปิด Email Notification');
  cfgEnsure_('EMAIL_SUBJECT',     '[TBS 2026] แจ้งเตือนการเปลี่ยนแปลงสถานะ', 'หัวข้ออีเมลแจ้งเตือน');
}

function ensureLineConfigDefaults_() {
  lineCfgEnsure_('GROUP_ID',          '',      'Group ID หลัก / ล่าสุด');
  lineCfgEnsure_('USER_ID',           '',      'User ID ล่าสุด');
  lineCfgEnsure_('CHANNEL_TOKEN_SET', 'FALSE', 'แสดงสถานะว่าตั้ง token ใน Script Properties แล้วหรือไม่');
  lineCfgEnsure_('AUTO_UPDATE_GROUP', cfgGet_('AUTO_UPDATE_GROUP', 'FALSE'), 'TRUE / FALSE');
  lineCfgEnsure_('LAST_GROUP_ID',     '',      'Group ID ล่าสุดที่ได้รับจาก Webhook');
  lineCfgEnsure_('LAST_USER_ID',      '',      'User ID ล่าสุดที่ได้รับจาก Webhook');
}

// ════════════════════════════════════════════════════════════════
//  LINE OA WEBHOOK — GROUP ID / USER ID / STATUS / CONFIG
// ════════════════════════════════════════════════════════════════

function handleLineWebhook_(payload) {
  try {
    setupSheetsSilent_();
    const events = payload.events || [];

    events.forEach(function(event) {
      const source = event.source || {};
      const groupId = source.groupId || '';
      const userId = source.userId || '';
      const roomId = source.roomId || '';
      const text = String((event.message && event.message.text) || '').trim();
      const lower = text.toLowerCase();

      if (groupId) {
        cfgSet_('LAST_GROUP_ID', groupId, 'Group ID ล่าสุดที่ระบบพบ');
        lineCfgSet_('LAST_GROUP_ID', groupId, 'Group ID ล่าสุดที่ได้รับจาก Webhook');
        lineCfgSet_('GROUP_ID', groupId, 'Group ID หลัก / ล่าสุด');
        updateLineToByPolicy_(groupId);
      }
      if (userId) {
        cfgSet_('LAST_USER_ID', userId, 'User ID ล่าสุดที่ระบบพบ');
        lineCfgSet_('LAST_USER_ID', userId, 'User ID ล่าสุดที่ได้รับจาก Webhook');
        lineCfgSet_('USER_ID', userId, 'User ID ล่าสุด');
      }
      if (roomId) {
        lineCfgSet_('ROOM_ID', roomId, 'Room ID ล่าสุด');
      }

      if (!event.replyToken || event.replyToken === '00000000000000000000000000000000') return;

      if (lower === 'groupid' || lower === 'group id') {
        replyMessage_(event.replyToken,
          '📌 TBS2026 Group ID\n' +
          (groupId ? groupId : 'ไม่พบ Group ID — โปรดพิมพ์คำสั่งนี้ในกลุ่ม LINE') +
          '\n\nLINE_TO ปัจจุบัน: ' + (cfgGet_('LINE_TO', '') || 'ยังไม่ตั้งค่า') +
          '\nAUTO_UPDATE_GROUP: ' + cfgGet_('AUTO_UPDATE_GROUP', 'FALSE')
        );
      } else if (lower === 'userid' || lower === 'user id') {
        replyMessage_(event.replyToken,
          '👤 TBS2026 User ID\n' +
          (userId ? userId : 'ไม่พบ User ID')
        );
      } else if (lower === 'tbs status') {
        replyMessage_(event.replyToken,
          '✅ TBS2026 Online\n' +
          'Webhook: Connected\n' +
          'LINE_TO: ' + (cfgGet_('LINE_TO', '') || 'ยังไม่ตั้งค่า') + '\n' +
          'LINE_ENABLED: ' + cfgGet_('LINE_ENABLED', 'TRUE')
        );
      } else if (lower === 'tbs config') {
        replyMessage_(event.replyToken,
          '⚙ TBS2026 LINE Config\n' +
          'LINE_TO: ' + (cfgGet_('LINE_TO', '') || 'ยังไม่ตั้งค่า') + '\n' +
          'AUTO_UPDATE_GROUP: ' + cfgGet_('AUTO_UPDATE_GROUP', 'FALSE') + '\n' +
          'LAST_GROUP_ID: ' + (cfgGet_('LAST_GROUP_ID', '') || '—') + '\n' +
          'LAST_USER_ID: ' + (cfgGet_('LAST_USER_ID', '') || '—')
        );
      }
    });

    return text_('OK');
  } catch (err) {
    log_('LINE_WEBHOOK_ERROR', String(err));
    return text_('OK');
  }
}

function updateLineToByPolicy_(groupId) {
  const currentLineTo = cfgGet_('LINE_TO', '');
  const autoUpdate = cfgGet_('AUTO_UPDATE_GROUP', 'FALSE').toUpperCase() === 'TRUE';

  // ครั้งแรก: ถ้า LINE_TO ว่าง ให้บันทึก Group ID อัตโนมัติ
  if (!currentLineTo) {
    cfgSet_('LINE_TO', groupId, 'Auto set from first LINE group event');
    log_('LINE_TO_AUTO_SET', groupId);
    return;
  }

  // ถ้าเปิด Auto Update จึงอัปเดตทับ
  if (autoUpdate && currentLineTo !== groupId) {
    cfgSet_('LINE_TO', groupId, 'Auto updated from LINE group event');
    log_('LINE_TO_AUTO_UPDATED', currentLineTo + ' -> ' + groupId);
  }
}

function replyMessage_(replyToken, text) {
  const token = getLineProp_('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token || !replyToken) return;

  try {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] }),
      muteHttpExceptions: true
    });
    log_('LINE_REPLY', res.getResponseCode() + ' ' + res.getContentText().slice(0, 120));
  } catch (err) {
    log_('LINE_REPLY_ERROR', String(err));
  }
}

function getLineConfig_() {
  const tokenSet = !!PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  lineCfgSet_('CHANNEL_TOKEN_SET', tokenSet ? 'TRUE' : 'FALSE', 'แสดงสถานะว่าตั้ง token ใน Script Properties แล้วหรือไม่');
  return {
    LINE_TO: cfgGet_('LINE_TO', ''),
    LINE_ENABLED: cfgGet_('LINE_ENABLED', 'TRUE'),
    AUTO_UPDATE_GROUP: cfgGet_('AUTO_UPDATE_GROUP', 'FALSE'),
    LAST_GROUP_ID: cfgGet_('LAST_GROUP_ID', ''),
    LAST_USER_ID: cfgGet_('LAST_USER_ID', ''),
    CHANNEL_TOKEN_SET: tokenSet
  };
}

function saveLineConfig_(data) {
  if (data.lineTo !== undefined) cfgSet_('LINE_TO', String(data.lineTo || '').trim(), 'Group ID หรือ User ID ปลายทาง สำหรับ LINE OA');
  if (data.lineEnabled !== undefined) cfgSet_('LINE_ENABLED', truthy_(data.lineEnabled) ? 'TRUE' : 'FALSE', 'TRUE / FALSE');
  if (data.autoUpdateGroup !== undefined) cfgSet_('AUTO_UPDATE_GROUP', truthy_(data.autoUpdateGroup) ? 'TRUE' : 'FALSE', 'TRUE = อัปเดต LINE_TO ตามกลุ่มล่าสุด, FALSE = ไม่เปลี่ยนอัตโนมัติ');
  // LINE_CHANNEL_ACCESS_TOKEN must be set manually in Apps Script Properties, not via web request.
  ensureLineConfigDefaults_();
  log_('saveLineConfig', 'updated');
  return json_({ ok: true, config: getLineConfig_() });
}

// ════════════════════════════════════════════════════════════════
//  ADMIN PIN CONFIG (Google Sheet: Config)
// ════════════════════════════════════════════════════════════════

function cfgGet_(key, fallback) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = getOrCreate_(ss, SHEET_CFG, ['Key','Value','Note']);
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === key) return String(vals[i][1] || '').trim() || fallback;
  }
  return fallback;
}

function cfgSet_(key, value, note) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = getOrCreate_(ss, SHEET_CFG, ['Key','Value','Note']);
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === key) {
      sh.getRange(i + 1, 2, 1, 2).setValues([[value, note || vals[i][2] || '']]);
      return;
    }
  }
  sh.appendRow([key, value, note || '']);
}

function cfgEnsure_(key, value, note) {
  const current = cfgGet_(key, null);
  if (current === null || current === undefined || current === '') cfgSet_(key, value, note);
}

function lineCfgGet_(key, fallback) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = getOrCreate_(ss, SHEET_LINECFG, ['Key','Value','Note']);
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === key) return String(vals[i][1] || '').trim() || fallback;
  }
  return fallback;
}

function lineCfgSet_(key, value, note) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = getOrCreate_(ss, SHEET_LINECFG, ['Key','Value','Note']);
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === key) {
      sh.getRange(i + 1, 2, 1, 2).setValues([[value, note || vals[i][2] || '']]);
      return;
    }
  }
  sh.appendRow([key, value, note || '']);
}

function lineCfgEnsure_(key, value, note) {
  const current = lineCfgGet_(key, null);
  if (current === null || current === undefined || current === '') lineCfgSet_(key, value, note);
}

function getAdminPins_() {
  return {
    HR:  cfgGet_('ADMIN_PIN_HR',  'HR2569'),
    OPS: cfgGet_('ADMIN_PIN_OPS', 'OPS2569'),
    ACC: cfgGet_('ADMIN_PIN_ACC', 'ACC2569'),
    ADM: cfgGet_('ADMIN_PIN_ADM', cfgGet_('ADMIN_CODE', '90230'))
  };
}

function validateAdminPin_(pin, e) {
  const code = String(pin || '').trim();
  const pins = getAdminPins_();
  const names = { HR:'HR&GA', OPS:'Operation', ACC:'บัญชีและการเงิน', ADM:'System Admin' };
  for (const unit in pins) {
    if (code && code === String(pins[unit])) {
      return out_({ ok:true, unit:unit, name:names[unit], isSystemAdmin:unit === 'ADM' }, e);
    }
  }
  return out_({ ok:false, error:'invalid pin' }, e);
}

function saveAdminPins_(data) {
  const pins = data.pins || {};
  const map = {
    HR:  ['ADMIN_PIN_HR',  'รหัส Admin HR&GA'],
    OPS: ['ADMIN_PIN_OPS', 'รหัส Admin Operation'],
    ACC: ['ADMIN_PIN_ACC', 'รหัส Admin บัญชีและการเงิน'],
    ADM: ['ADMIN_PIN_ADM', 'รหัส System Admin']
  };
  Object.keys(map).forEach(function(unit) {
    const v = String(pins[unit] || '').trim();
    if (v) cfgSet_(map[unit][0], v, map[unit][1]);
  });
  log_('saveAdminPins', 'updated by ' + (data.updateBy || 'System Admin'));
  return json_({ ok:true });
}

function getPublicConfig_() {
  return {
    periodName: cfgGet_('PERIOD_NAME', ''),
    lineEnabled: cfgGet_('LINE_ENABLED', 'TRUE'),
    autoUpdateGroup: cfgGet_('AUTO_UPDATE_GROUP', 'FALSE')
  };
}



// ════════════════════════════════════════════════════════════════
//  EMPLOYEE MASTER NORMALIZATION
//  รองรับไฟล์ Excel เดิมที่สะกด Division เป็น Devistion และมี Company
// ════════════════════════════════════════════════════════════════
function normalizeEmployeeObj_(obj) {
  obj = obj || {};
  const division = obj.Division || obj.division || obj.Devistion || obj.devistion || obj.Devision || obj.devision || '';
  const section  = obj.Section  || obj.section  || '';
  const dept     = obj.Dept     || obj.dept     || obj.Department || obj.department || '';
  const company  = obj.Company  || obj.company  || '';
  const group    = obj.Group    || obj.group    || '';
  const activeRaw = obj.Active !== undefined ? obj.Active : obj.active;

  return {
    EmpID:    String(obj.EmpID || obj.empId || obj.id || obj.ID || '').trim(),
    Name:     String(obj.Name  || obj.name || '').trim(),
    Role:     String(obj.Role  || obj.role || '').trim(),
    Group:    String(group || '').trim(),
    Division: String(division || '').trim(),
    Section:  String(section || '').trim(),
    Dept:     String(dept || '').trim(),
    Company:  String(company || 'SML').trim(),
    Active:   activeRaw === undefined || activeRaw === '' ? true : !['false','FALSE','0','NO','No','no'].includes(String(activeRaw).trim())
  };
}

function employeeToRow_(emp) {
  emp = normalizeEmployeeObj_(emp);
  return [emp.EmpID, emp.Name, emp.Role, emp.Group, emp.Division, emp.Section, emp.Dept, emp.Company, emp.Active];
}

function migrateEmployeeSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = getOrCreate_(ss, SHEET_EMP, EMP_HEADERS);
  const vals = sh.getDataRange().getValues();
  if (vals.length === 0) {
    sh.appendRow(EMP_HEADERS);
    styleHeader_(sh.getRange(1,1,1,EMP_HEADERS.length));
    return sh;
  }

  const hdrs = vals[0].map(function(h){ return String(h || '').trim(); });
  const isCanonical = EMP_HEADERS.every(function(h, i){ return hdrs[i] === h; }) && hdrs.length >= EMP_HEADERS.length;
  if (isCanonical) return sh;

  const rows = [];
  const seen = {};
  for (let r = 1; r < vals.length; r++) {
    const obj = {};
    hdrs.forEach(function(h, i){ obj[h] = vals[r][i]; });
    const emp = normalizeEmployeeObj_(obj);
    if (!emp.EmpID && !emp.Name) continue;
    const key = emp.EmpID || emp.Name;
    if (seen[key]) continue;
    seen[key] = true;
    rows.push(employeeToRow_(emp));
  }

  sh.clear();
  sh.getRange(1,1,1,EMP_HEADERS.length).setValues([EMP_HEADERS]);
  if (rows.length) sh.getRange(2,1,rows.length,EMP_HEADERS.length).setValues(rows);
  styleHeader_(sh.getRange(1,1,1,EMP_HEADERS.length));
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, EMP_HEADERS.length);
  return sh;
}

function getEmployeeMap_() {
  const list = getEmployees_();
  const byId = {};
  const byName = {};
  list.forEach(function(e) {
    if (e.EmpID) byId[String(e.EmpID)] = e;
    if (e.Name) byName[String(e.Name)] = e;
  });
  return { byId: byId, byName: byName, list: list };
}

function buildRowsFromAttendance_(members, workdays) {
  const att = getAttendance_();
  const byKey = {};
  const byNameDate = {};
  att.forEach(function(a) {
    const id = String(a.EmpID || '').trim();
    const name = String(a.Name || '').trim();
    const dl = String(a.DateLabel || '').trim();
    if (id && dl) byKey[id + '|' + dl] = a;
    if (name && dl) byNameDate[name + '|' + dl] = a;
  });
  const def = cfgGet_('DEFAULT_STATUS', 'On') || 'On';
  return members.map(function(m) {
    const emp = normalizeEmployeeObj_(m);
    return {
      id: emp.EmpID, name: emp.Name, role: emp.Role,
      group: emp.Group, division: emp.Division, section: emp.Section, dept: emp.Dept, company: emp.Company,
      states: workdays.map(function(d) {
        const label = d.label || d.Label || '';
        const rec = byKey[emp.EmpID + '|' + label] || byNameDate[emp.Name + '|' + label];
        return rec ? String(rec.Status || '') : def;
      })
    };
  });
}

// ════════════════════════════════════════════════════════════════
//  EMPLOYEE MASTER — Online Database
// ════════════════════════════════════════════════════════════════
function addOrUpdateEmployee_(data) {
  const emp = normalizeEmployeeObj_(data.employee || {});
  if (!emp.EmpID || !emp.Name) return json_({ ok:false, error:'missing employee id/name' });

  setupSheetsSilent_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = migrateEmployeeSheet_();
  const vals = sh.getDataRange().getValues();
  const row = employeeToRow_(emp);

  let found = 0;
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === emp.EmpID) { found = i + 1; break; }
  }

  if (found) {
    const oldName = String(sh.getRange(found, 2).getValue() || '');
    sh.getRange(found, 1, 1, EMP_HEADERS.length).setValues([row]);
    if (oldName && oldName !== emp.Name) renameAttendanceEmployee_(emp.EmpID, oldName, emp.Name);
  } else {
    sh.appendRow(row);
  }
  sh.autoResizeColumns(1, EMP_HEADERS.length);
  log_('employee_upsert', emp.EmpID + ' ' + emp.Name + ' by ' + (data.updateBy || 'System Admin'));
  return json_({ ok:true, employee: normalizeEmployeeObj_(emp) });
}

function deleteEmployee_(data) {
  const id = String(data.empId || data.id || '').trim();
  const name = String(data.name || '').trim();
  if (!id && !name) return json_({ ok:false, error:'missing employee id/name' });

  setupSheets();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const empSh = getOrCreate_(ss, SHEET_EMP, EMP_HEADERS);
  const vals = empSh.getDataRange().getValues();
  for (let i = vals.length - 1; i >= 1; i--) {
    if ((id && String(vals[i][0]).trim() === id) || (name && String(vals[i][1]).trim() === name)) {
      empSh.deleteRow(i + 1);
    }
  }

  const attSh = getOrCreate_(ss, SHEET_ATT, ATT_HEADERS);
  const av = attSh.getDataRange().getValues();
  for (let i = av.length - 1; i >= 1; i--) {
    if ((id && String(av[i][1]).trim() === id) || (name && String(av[i][2]).trim() === name)) {
      attSh.deleteRow(i + 1);
    }
  }
  log_('employee_delete', (id || name) + ' by ' + (data.updateBy || 'System Admin'));
  return json_({ ok:true });
}

function renameAttendanceEmployee_(empId, oldName, newName) {
  const sh = getOrCreate_(SpreadsheetApp.getActiveSpreadsheet(), SHEET_ATT, ATT_HEADERS);
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][1]).trim() === String(empId).trim() || String(vals[i][2]).trim() === oldName) {
      const dateLabel = vals[i][3];
      sh.getRange(i + 1, 1, 1, 3).setValues([[String(empId).trim() + '|' + dateLabel, empId, newName]]);
    }
  }
}

// ════════════════════════════════════════════════════════════════
//  DATA OPERATIONS
// ════════════════════════════════════════════════════════════════

function initSheet_(data) {
  setupSheetsSilent_();
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const empSh = migrateEmployeeSheet_();
  const daySh = ss.getSheetByName(SHEET_DAYS);

  // PDPA safe: ถ้า HTML ไม่มี employee master อย่าล้าง Employees
  const members = data.members || [];
  if (members.length) {
    clearBody_(empSh);
    members.forEach(function(m) {
      empSh.appendRow(employeeToRow_({
        EmpID:m.id||m.EmpID||'', Name:m.name||m.Name||'', Role:m.role||m.Role||'',
        Group:m.group||m.Group||'', Division:m.division||m.Division||m.Devistion||'',
        Section:m.section||m.Section||'', Dept:m.dept||m.Dept||'', Company:m.company||m.Company||'SML',
        Active: m.active !== undefined ? m.active : true
      }));
    });
  }

  clearBody_(daySh);
  (data.days || []).forEach(function(d) {
    daySh.appendRow([d.date||'', d.label||'', d.dayName||'', d.type||'', data.period||'', d.holiday||'']);
  });

  empSh.autoResizeColumns(1, EMP_HEADERS.length);
  daySh.autoResizeColumns(1, 6);
  log_('initSheet', 'members=' + members.length + ', days=' + (data.days||[]).length);
  return json_({ ok: true, sheetUrl: ss.getUrl() });
}

function syncAll_(data) {
  const days = getDays_().filter(function(d) { return d.type === 'work'; });
  (data.rows || []).forEach(function(r, rowIndex) {
    (r.states || []).forEach(function(state, colIndex) {
      const day = days[colIndex] || { label: String(colIndex + 1) };
      upsertAttendance_({
        empId: r.id || r.name || '',
        name: r.name || '',
        dateLabel: day.label,
        status: state || '',
        updateBy: 'Admin Sync',
        rowIndex: rowIndex,
        colIndex: colIndex
      });
    });
  });
  log_('syncAll', 'rows=' + (data.rows||[]).length);
  return json_({ ok: true });
}

function updateCell_(data) {
  const rec = {
    empId:     data.empId     || '',
    name:      data.memberName || data.empName || '',
    dateLabel: data.dateLabel  || data.date    || '',
    status:    data.newState   || data.status  || '',
    updateBy:  data.updateBy   || 'Employee',
    rowIndex:  data.rowIndex   || '',
    colIndex:  data.colIndex   || ''
  };
  const oldState = upsertAttendance_(rec);
  log_('updateCell', rec.empId + ' ' + rec.name + ' ' + rec.dateLabel + ' => ' + rec.status);

  // แจ้งเตือนเฉพาะเมื่อมีสถานะจริง และมีการเปลี่ยนแปลง หรือเป็นรายการใหม่
  // data.silent = true → ข้ามการแจ้งทีละช่อง (ใช้ตอนพนักงานกดบันทึก แล้วสรุปแจ้งครั้งเดียวจากฝั่ง client)
  if (rec.status && !data.silent) notifyChange_(rec, oldState);

  return json_({ ok: true, oldState: oldState || '' });
}

// แจ้งเตือนเมื่อสถานะเปลี่ยน — ทั้ง LINE และ Email ตาม Config ฝั่ง Server (ทำงานได้จากทุกเครื่อง)
function notifyChange_(r, oldState) {
  if (oldState && oldState === r.status) return; // ไม่เปลี่ยน ไม่แจ้ง
  notifyLineOA_(r, oldState);
  notifyChangeEmail_(r, oldState);
}

function notifyChangeEmail_(r, oldState) {
  if (getLineProp_('EMAIL_ENABLED').toUpperCase() !== 'TRUE') return;
  const to = getLineProp_('EMAIL_TO');
  if (!to) return;
  if (oldState && oldState === r.status) return;

  const TH = { On:'มาทำงาน', Off:'หยุด 75%', 'พร.':'ลาพักร้อน', 'กิจ':'ลากิจ', 'ป่วย':'ลาป่วย', '':'—' };
  const before = oldState ? (TH[oldState] || oldState) : '—';
  const after  = TH[r.status] || r.status || '—';
  const body = [
    'แจ้งการเปลี่ยนแปลงสถานะ — Temporary Business Suspension (75% Compensation) 2026', '',
    'พนักงาน  : ' + r.name + ' (' + r.empId + ')',
    'วันที่     : ' + r.dateLabel,
    'สถานะเดิม : ' + before,
    'สถานะใหม่ : ' + after,
    'แก้ไขโดย  : ' + r.updateBy,
    'เวลา      : ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') + ' น.', '',
    '──────────────────────────────',
    'บริษัท สยามกลการโลจิสติกส์ จำกัด (SML)'
  ].join('\n');
  const cc = (getLineProp_('EMAIL_CC') || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean).join(',');
  try {
    MailApp.sendEmail({
      to: to,
      cc: cc,
      subject: getLineProp_('EMAIL_SUBJECT') || '[TBS 2026] แจ้งเตือนการเปลี่ยนแปลงสถานะ',
      body: body
    });
    log_('EMAIL_CHANGE', 'ok ' + to);
  } catch (err) {
    log_('EMAIL_CHANGE_ERROR', err.message);
  }
}

function upsertAttendance_(r) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = getOrCreate_(ss, SHEET_ATT, ATT_HEADERS);
  const key = (r.empId || r.name) + '|' + r.dateLabel;
  const vals = sh.getDataRange().getValues();

  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] === key) {
      const oldState = vals[i][4] || '';
      sh.getRange(i+1, 1, 1, 9).setValues([[
        key, r.empId, r.name, r.dateLabel,
        r.status, r.updateBy, new Date(), r.rowIndex, r.colIndex
      ]]);
      colorCell_(sh.getRange(i+1, 5), r.status);
      return oldState;
    }
  }
  sh.appendRow([key, r.empId, r.name, r.dateLabel, r.status, r.updateBy, new Date(), r.rowIndex, r.colIndex]);
  colorCell_(sh.getRange(sh.getLastRow(), 5), r.status);
  return '';
}

function colorCell_(range, status) {
  const colors = { On:'#DBEAFE', Off:'#FEE2E2', 'พร.':'#FEF3C7', 'กิจ':'#D1FAE5', 'ป่วย':'#EDE9FE' };
  range.setBackground(colors[status] || '#FFFFFF');
}

// ════════════════════════════════════════════════════════════════
//  AUDIT LOG
// ════════════════════════════════════════════════════════════════

function addAuditLog_(payload) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = getOrCreate_(ss, SHEET_NOTIFY,
    ['Timestamp','Type','EmpID','EmpName','Date','OldState','NewState','UpdateBy','LineResult','EmailResult']);
  const d   = payload.log || {};
  const TH  = { On:'มาทำงาน', Off:'หยุด 75%', 'พร.':'พักร้อน', 'กิจ':'ลากิจ', 'ป่วย':'ลาป่วย', '':'—' };
  const row = [
    new Date(d.ts || new Date()),
    d.action || '—', d.userId || '—', d.user || '—', d.dateLabel || '—',
    TH[d.oldState] || d.oldState || '—',
    TH[d.newState] || d.newState || '—',
    d.user || '—', '', ''
  ];
  sh.appendRow(row);

  const ACTION_COLOR = {
    'เข้าสู่ระบบ':'#D1FAE5', 'ออกจากระบบ':'#FEE2E2',
    'เปลี่ยนสถานะ':'#DBEAFE', 'เลือกสถานะ':'#DBEAFE', 'เติมทั้งแถว':'#FEF3C7'
  };
  sh.getRange(sh.getLastRow(), 1, 1, 10).setBackground(ACTION_COLOR[d.action] || '#FFFFFF');
  styleHeader_(sh.getRange(1, 1, 1, 10));
  SpreadsheetApp.flush();
  return json_({ ok: true, row: sh.getLastRow() });
}

// ════════════════════════════════════════════════════════════════
//  NOTIFICATION — LINE OA Messaging API + Email
// ════════════════════════════════════════════════════════════════

function getLineProp_(key) {
  // Security rule: LINE Channel Access Token is a secret.
  // It must come from Apps Script Properties only, never from Google Sheet or browser payload.
  const props = PropertiesService.getScriptProperties();
  if (key === 'LINE_CHANNEL_ACCESS_TOKEN') {
    return props.getProperty(key) || '';
  }
  return props.getProperty(key) || getConfigValue_(key) || '';
}

function saveNotifyConfig_(data) {
  // ใช้ cfgSet_ (มีอยู่จริง) — เดิมเรียก setConfigValue_ ที่ไม่ถูกประกาศ ทำให้บันทึก config ล้มเหลวเงียบๆ
  cfgSet_('LINE_ENABLED', data.lineEnabled ? 'TRUE' : 'FALSE');
  if (data.lineToId !== undefined) cfgSet_('LINE_TO', data.lineToId || '');
  if (data.lineTemplate !== undefined) cfgSet_('LINE_TEMPLATE', data.lineTemplate || '');
  cfgSet_('EMAIL_ENABLED', data.emailEnabled ? 'TRUE' : 'FALSE');
  if (data.emailTo !== undefined) cfgSet_('EMAIL_TO', data.emailTo || '');
  if (data.emailCc !== undefined) cfgSet_('EMAIL_CC', data.emailCc || '');
  if (data.emailSubject !== undefined) cfgSet_('EMAIL_SUBJECT', data.emailSubject || '');
  log_('SAVE_NOTIFY_CONFIG', 'ok');
  return json_({ ok: true });
}

function handleNotify_(data) {
  const results = {};

  const token = getLineProp_('LINE_CHANNEL_ACCESS_TOKEN');
  const to    = data.lineToId  || getLineProp_('LINE_TO');
  const lineOn = data.lineEnabled === true || data.lineEnabled === 'true' ||
                 getLineProp_('LINE_ENABLED').toUpperCase() === 'TRUE';

  if (lineOn && token && to && data.lineMessage) {
    try {
      const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + token },
        payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: data.lineMessage }] }),
        muteHttpExceptions: true
      });
      const rc = res.getResponseCode();
      results.lineOA = rc === 200 ? 'ok' : 'HTTP ' + rc + ' ' + res.getContentText().slice(0, 120);
      log_('LINE_OA', results.lineOA);
    } catch(err) {
      results.lineOA = 'error: ' + err.message;
      log_('LINE_OA_ERROR', err.message);
    }
  }

  const emailEnabled = data.emailEnabled === true || data.emailEnabled === 'true' ||
                       getLineProp_('EMAIL_ENABLED').toUpperCase() === 'TRUE';
  const emailTo = data.emailTo || getLineProp_('EMAIL_TO');
  const emailBody = data.emailBody || data.lineMessage || '';

  if (emailEnabled && emailTo && emailBody) {
    try {
      const toList = String(emailTo).split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      const ccList = (data.emailCc || getLineProp_('EMAIL_CC') || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      MailApp.sendEmail({
        to: toList.join(','),
        cc: ccList.join(','),
        subject: data.emailSubject || getLineProp_('EMAIL_SUBJECT') || '[TBS 2026] แจ้งเตือนการเปลี่ยนแปลงสถานะ',
        body: emailBody
      });
      results.email = 'ok';
    } catch(err) {
      results.email = 'error: ' + err.message;
      log_('EMAIL_ERROR', err.message);
    }
  } else {
    results.email = 'skip: emailEnabled=' + emailEnabled + ', emailTo=' + (emailTo ? 'yes' : 'no') + ', emailBody=' + (emailBody ? 'yes' : 'no');
  }

  logNotify_(data.lineMessage || data.emailSubject || '', results);
  return json_({ ok: true, results: results });
}

function notifyLineOA_(r, oldState) {
  const enabled = getLineProp_('LINE_ENABLED').toUpperCase();
  if (enabled !== 'TRUE') return;

  const token = getLineProp_('LINE_CHANNEL_ACCESS_TOKEN');
  const to    = getLineProp_('LINE_TO');
  if (!token || !to) return;

  // ถ้าเก่าเท่าใหม่ ไม่ต้องแจ้ง
  if (oldState && oldState === r.status) return;

  const TH = { On:'On — มาทำงาน ✓', Off:'Off — หยุด 75% ✕', 'พร.':'ลา — พักร้อน 🌴', 'กิจ':'ลา — ลากิจ 📋', 'ป่วย':'ลา — ลาป่วย 🤒', '':'—' };
  const before = oldState ? (TH[oldState] || oldState) : '—';
  const after  = TH[r.status] || r.status || '—';

  const msg = [
    '🔔 TBS 2026 — อัปเดตสถานะ', '',
    '👤 ' + r.name + ' (' + r.empId + ')',
    '📅 วันที่: ' + r.dateLabel,
    '📋 สถานะ: ' + before + ' ➜ ' + after,
    '✏ แก้ไขโดย: ' + r.updateBy,
    '⏰ เวลา: ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm น.')
  ].join('\n');

  sendLinePush_(to, msg, token);
}

function sendLinePush_(to, text, token) {
  try {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: text }] }),
      muteHttpExceptions: true
    });
    log_('LINE_PUSH', res.getResponseCode() + ' ' + res.getContentText().slice(0, 120));
  } catch(err) {
    log_('LINE_PUSH_ERROR', err.message);
  }
}

function testLine_() {
  const token = getLineProp_('LINE_CHANNEL_ACCESS_TOKEN');
  const to    = getLineProp_('LINE_TO');
  if (!token || !to) {
    return json_({ ok: false, error: 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN หรือ LINE_TO' });
  }
  sendLinePush_(to, '✅ ทดสอบ TBS 2026 สำเร็จ\n' + new Date().toLocaleString('th-TH'), token);
  return json_({ ok: true, message: 'ส่งแล้ว ตรวจสอบ LINE' });
}

function logNotify_(msg, results) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = getOrCreate_(ss, SHEET_NOTIFY,
    ['Timestamp','Type','EmpID','EmpName','Date','OldState','NewState','UpdateBy','LineResult','EmailResult']);
  sh.appendRow([new Date(), 'Notify', '', '', '', '', '', msg,
    JSON.stringify(results.lineOA || '—'),
    JSON.stringify(results.email  || '—')]);
}

// ════════════════════════════════════════════════════════════════
//  EXECUTIVE REPORT
// ════════════════════════════════════════════════════════════════

function createExecutiveReport_(data) {
  setupSheetsSilent_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const inputMembers = (data.members || []).map(normalizeEmployeeObj_).filter(function(e){ return e.EmpID || e.Name; });
  let members = inputMembers.length ? inputMembers : getEmployees_().map(normalizeEmployeeObj_);

  const allDaysInput = (data.days || []);
  let allDays = allDaysInput.length ? allDaysInput : getDays_();
  const workdays = allDays.filter(function(d) { return (d.type || d.Type) === 'work'; });
  const period  = data.period || cfgGet_('PERIOD_NAME', 'TBS 2026');

  let rows = data.rows || [];
  // ถ้า payload ไม่ครบ ให้สร้างจาก Attendance ใน Google เพื่อไม่ให้ Report ข้อมูลขาด
  if (!rows.length || rows.length < members.length) {
    rows = buildRowsFromAttendance_(members, workdays);
  } else {
    rows = rows.map(function(r) {
      const empMatch = members.find(function(m){ return String(m.EmpID) === String(r.id || r.EmpID || '') || String(m.Name) === String(r.name || r.Name || ''); }) || {};
      const emp = normalizeEmployeeObj_(Object.assign({}, empMatch, r, {
        EmpID: r.id || r.EmpID || empMatch.EmpID,
        Name: r.name || r.Name || empMatch.Name,
        Role: r.role || r.Role || empMatch.Role,
        Group: r.group || r.Group || empMatch.Group,
        Division: r.division || r.Division || r.Devistion || empMatch.Division,
        Section: r.section || r.Section || empMatch.Section,
        Dept: r.dept || r.Dept || empMatch.Dept,
        Company: r.company || r.Company || empMatch.Company
      }));
      return {
        id: emp.EmpID, name: emp.Name, role: emp.Role, group: emp.Group, division: emp.Division, section: emp.Section, dept: emp.Dept, company: emp.Company,
        states: r.states || []
      };
    });
  }

  const dash   = resetSheet_(ss, SHEET_DASH);
  const matrix = resetSheet_(ss, SHEET_MATRIX);
  const detail = resetSheet_(ss, SHEET_DETAIL);

  [['A1','บริษัท สยามกลการโลจิสติกส์ จำกัด (SML)'],
   ['A2','รายงานสถานะพนักงาน — Temporary Business Suspension (75% Compensation) 2026'],
   ['A3', period], ['A4','วันที่ออกรายงาน'], ['B4', new Date()]
  ].forEach(function(pair) { dash.getRange(pair[0]).setValue(pair[1]); });
  dash.getRange('A1:B2').setFontWeight('bold').setFontSize(13).setFontColor('#1B4F8A');
  dash.getRange('B4').setNumberFormat('dd/mm/yyyy hh:mm');

  const allStates = ['On','Off','พร.','กิจ','ป่วย'];
  const counts = { On:0, Off:0, 'พร.':0, 'กิจ':0, 'ป่วย':0 };
  let totalOn = 0, totalCells = 0;
  rows.forEach(function(r) {
    (r.states || []).forEach(function(s) {
      if (allStates.includes(s)) counts[s]++;
      totalCells++;
      if (s === 'On') totalOn++;
    });
  });
  const pctOn = totalCells > 0 ? (totalOn / totalCells * 100).toFixed(1) : '0';

  const summary = [
    ['รายการ','จำนวน','หมายเหตุ'],
    ['พนักงานทั้งหมด', members.length, 'คน'],
    ['วันทำงานในช่วง', workdays.length, 'วัน'],
    ['','',''],
    ['On — มาทำงาน',   counts['On'],   totalCells ? (counts['On']/totalCells*100).toFixed(1)+'%' : '—'],
    ['Off — หยุด 75%', counts['Off'],  totalCells ? (counts['Off']/totalCells*100).toFixed(1)+'%' : '—'],
    ['พักร้อน (พร.)',  counts['พร.'],  'วัน'],
    ['ลากิจ (กิจ)',    counts['กิจ'],  'วัน'],
    ['ลาป่วย (ป่วย)', counts['ป่วย'], 'วัน'],
    ['','',''],
    ['% มาทำงานเฉลี่ย', pctOn+'%', 'ทุกคนรวมกัน']
  ];
  dash.getRange(6, 1, summary.length, 3).setValues(summary);
  styleHeader_(dash.getRange(6, 1, 1, 3));
  [[10,'#DBEAFE'],[11,'#FEE2E2'],[12,'#FEF3C7'],[13,'#D1FAE5'],[14,'#EDE9FE']].forEach(function(x) {
    dash.getRange(x[0], 1, 1, 3).setBackground(x[1]);
  });
  dash.getRange(16, 1, 1, 3).setFontWeight('bold').setBackground('#E0F2FE');
  dash.autoResizeColumns(1, 3);

  try {
    dash.insertChart(dash.newChart().setChartType(Charts.ChartType.PIE)
      .addRange(dash.getRange(10, 1, 5, 2))
      .setPosition(6, 5, 0, 0)
      .setOption('title', 'สัดส่วนสถานะพนักงาน').build());
  } catch(e) {}

  const mHdr = ['รหัส','ชื่อ-นามสกุล','บริษัท','หน่วยงาน/สังกัด','ฝ่าย','ส่วน','แผนก','ตำแหน่ง']
    .concat(workdays.map(function(d) { return d.label || d.Label; }))
    .concat(['On (มาทำงาน)','Off (หยุด 75%)','ลารวม','% มาทำงาน']);
  const mVals = [mHdr];
  rows.forEach(function(r) {
    const st = r.states || [];
    const on = st.filter(function(s) { return s === 'On'; }).length;
    const off = st.filter(function(s) { return s === 'Off'; }).length;
    const la = st.filter(function(s) { return ['พร.','กิจ','ป่วย'].includes(s); }).length;
    const pct = workdays.length > 0 ? (on/workdays.length*100).toFixed(1)+'%' : '—';
    mVals.push([r.id||'',r.name||'',r.company||'',r.group||'',r.division||'',r.section||'',r.dept||'',r.role||''].concat(st, [on,off,la,pct]));
  });
  matrix.getRange(1, 1, mVals.length, mHdr.length).setValues(mVals);
  styleHeader_(matrix.getRange(1, 1, 1, mHdr.length));
  matrix.setFrozenRows(1);
  matrix.setFrozenColumns(2);
  if (mVals.length > 1) applyMatrixColors_(matrix, 2, 9, mVals.length-1, workdays.length);
  matrix.getRange(1, 1, mVals.length, mHdr.length).setBorder(true, true, true, true, true, true, '#D1D5DB', SpreadsheetApp.BorderStyle.SOLID);
  matrix.autoResizeColumns(1, Math.min(mHdr.length, 12));

  const dHdr  = ['วันที่','รหัส','ชื่อ','บริษัท','หน่วยงาน/สังกัด','ฝ่าย','ส่วน','แผนก','สถานะ','ความหมาย','ผู้แก้ไข','วันที่รายงาน'];
  const dVals = [dHdr];
  const TH_FULL = { On:'มาทำงาน', Off:'หยุด 75%', 'พร.':'ลาพักร้อน', 'กิจ':'ลากิจ', 'ป่วย':'ลาป่วย' };
  rows.forEach(function(r) {
    (r.states || []).forEach(function(s, i) {
      dVals.push([workdays[i] ? (workdays[i].label || workdays[i].Label) : '', r.id||'', r.name||'', r.company||'', r.group||'', r.division||'', r.section||'', r.dept||'', s||'', TH_FULL[s]||s||'—', 'Web', new Date()]);
    });
  });
  detail.getRange(1, 1, dVals.length, dHdr.length).setValues(dVals);
  styleHeader_(detail.getRange(1, 1, 1, dHdr.length));
  detail.setFrozenRows(1);
  if (dVals.length > 1) applyMatrixColors_(detail, 2, 9, dVals.length-1, 1);
  detail.getRange(1, 1, dVals.length, dHdr.length).setBorder(true, true, true, true, true, true, '#D1D5DB', SpreadsheetApp.BorderStyle.SOLID);
  detail.autoResizeColumns(1, dHdr.length);

  SpreadsheetApp.flush();
  log_('createExecutiveReport', 'members=' + members.length + ', workdays=' + workdays.length + ', rows=' + rows.length);
  return json_({ ok: true, sheetUrl: ss.getUrl(), sheets: [SHEET_DASH, SHEET_MATRIX, SHEET_DETAIL] });
}

function applyMatrixColors_(sh, startRow, startCol, numRows, numCols) {
  if (numRows <= 0 || numCols <= 0) return;
  const vals = sh.getRange(startRow, startCol, numRows, numCols).getValues();
  const bgs  = vals.map(function(row) {
    return row.map(function(v) {
      return v==='On'?'#DBEAFE':v==='Off'?'#FEE2E2':v==='พร.'?'#FEF3C7':v==='กิจ'?'#D1FAE5':v==='ป่วย'?'#EDE9FE':'#FFFFFF';
    });
  });
  sh.getRange(startRow, startCol, numRows, numCols).setBackgrounds(bgs).setHorizontalAlignment('center');
}

// ════════════════════════════════════════════════════════════════
//  DATA READERS
// ════════════════════════════════════════════════════════════════

function getAttendance_() {
  const sh = getOrCreate_(SpreadsheetApp.getActiveSpreadsheet(), SHEET_ATT,
    ATT_HEADERS);
  const vals = sh.getDataRange().getValues();
  const hdrs = vals.shift() || [];
  return vals.map(function(row) { return Object.fromEntries(hdrs.map(function(h, i) { return [h, row[i]]; })); });
}

function getDays_() {
  const sh = getOrCreate_(SpreadsheetApp.getActiveSpreadsheet(), SHEET_DAYS,
    ['Date','Label','DayName','Type','Period','Holiday']);
  const vals = sh.getDataRange().getValues();
  const hdrs = vals.shift() || [];
  return vals.map(function(row) {
    const obj = Object.fromEntries(hdrs.map(function(h, i) {
      return [String(h).charAt(0).toLowerCase()+String(h).slice(1), row[i]];
    }));
    // แปลง Date object → ISO string เสมอ เพื่อให้ HTML parseGoogleDate ทำงานได้
    if (obj.date instanceof Date) {
      const d = obj.date;
      const yyyy = d.getFullYear();
      const mm   = String(d.getMonth()+1).padStart(2,'0');
      const dd   = String(d.getDate()).padStart(2,'0');
      obj.date = yyyy + '-' + mm + '-' + dd;
    } else if (obj.date) {
      obj.date = String(obj.date).slice(0,10);
    }
    return obj;
  }).filter(function(d){ return !!d.date; });
}

function getEmployees_() {
  const sh = migrateEmployeeSheet_();
  const vals = sh.getDataRange().getValues();
  const hdrs = vals.shift() || [];
  const out = [];
  vals.forEach(function(row) {
    const obj = Object.fromEntries(hdrs.map(function(h, i) { return [h, row[i]]; }));
    const emp = normalizeEmployeeObj_(obj);
    if (!emp.EmpID && !emp.Name) return;
    if (emp.Active === false) return;
    out.push(emp);
  });
  return out;
}

function getConfigValue_(key) {
  const sh = getOrCreate_(SpreadsheetApp.getActiveSpreadsheet(), SHEET_CFG, ['Key','Value','Note']);
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === key) return String(vals[i][1]).trim();
  }
  return '';
}

// ════════════════════════════════════════════════════════════════
//  UTILITIES
// ════════════════════════════════════════════════════════════════

function setupSheetsSilent_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  getOrCreate_(ss, SHEET_EMP,    EMP_HEADERS);
  migrateEmployeeSheet_();
  getOrCreate_(ss, SHEET_DAYS,   ['Date','Label','DayName','Type','Period','Holiday']);
  getOrCreate_(ss, SHEET_ATT,    ATT_HEADERS);
  getOrCreate_(ss, SHEET_LOG,    ['Time','Action','Detail']);
  getOrCreate_(ss, SHEET_NOTIFY, ['Timestamp','Type','EmpID','EmpName','Date','OldState','NewState','UpdateBy','LineResult','EmailResult']);
  getOrCreate_(ss, SHEET_CFG,    ['Key','Value','Note']);
  getOrCreate_(ss, SHEET_LINECFG,['Key','Value','Note']);
  ensureCfgDefaults_();
  ensureLineConfigDefaults_();
}

function getOrCreate_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    styleHeader_(sh.getRange(1,1,1,headers.length));
  }
  return sh;
}

function resetSheet_(ss, name) {
  let sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  sh.clearFormats();
  return sh;
}

function clearBody_(sh) {
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow()-1, Math.max(1, sh.getLastColumn())).clearContent();
  }
}

function styleHeader_(range) {
  range.setBackground('#1B4F8A').setFontColor('#FFFFFF')
       .setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle');
}

function log_(action, detail) {
  try {
    getOrCreate_(SpreadsheetApp.getActiveSpreadsheet(), SHEET_LOG, ['Time','Action','Detail'])
      .appendRow([new Date(), action, detail]);
  } catch (err) {}
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function out_(obj, e) {
  const cb = e && e.parameter && e.parameter.callback;
  if (cb) {
    const safeCb = String(cb).replace(/[^a-zA-Z0-9_.$]/g, '');
    return ContentService
      .createTextOutput(safeCb + '(' + JSON.stringify(obj) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(obj);
}

function text_(txt) {
  return ContentService.createTextOutput(txt).setMimeType(ContentService.MimeType.TEXT);
}

function truthy_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE' || String(v) === '1' || String(v).toLowerCase() === 'yes';
}
