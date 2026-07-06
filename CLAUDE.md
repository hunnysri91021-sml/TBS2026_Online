# TBS2026_Online — Notes for Claude

## Export column order (สำคัญ — ต้องเรียงลำดับนี้เสมอ)

ทุกครั้งที่เพิ่ม/แก้โค้ด export ข้อมูล (Excel/รายงาน) ที่มีคอลัมน์ระดับหน่วยงาน
ต้องเรียงคอลัมน์ตามลำดับชั้นองค์กรนี้เสมอ:

1. หน่วยงาน (Group) — field: `emp.group`
2. แผนก (Section) — field: `emp.section`
3. ส่วน (Division) — field: `emp.division`
4. ฝ่าย (Department) — field: `emp.dept`
5. บริษัท (Company) — field: `emp.company` (ปิดท้ายเสมอ)

คอลัมน์อื่น (ชื่อ-นามสกุล, รหัส, ตำแหน่ง) ให้อยู่ก่อนกลุ่มลำดับชั้นนี้.

ตรวจสอบแล้วและแก้ให้ตรงตามลำดับนี้ใน `index.html`:
- `exportExcel()` — ชีท "ตารางรายวัน" (`FIXED_COLS`) และ "สรุปรายบุคคล" (`H2`)
- `buildModifiedWorkbook()` — ชีท "ตารางการแก้ไข" และ "รายการแก้ไข"
- `buildSaveChangeWorkbook()` — ชีท "ตารางการแก้ไข"

หากเพิ่ม export ใหม่ที่มีคอลัมน์เหล่านี้ ให้เรียงตามลำดับข้างต้นด้วย.
