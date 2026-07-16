# TBS 2026 – Temporary Business Suspension Management System

## Overview

TBS 2026 เป็นระบบบริหารจัดการสถานะการปฏิบัติงานพนักงานในช่วงหยุดกิจการชั่วคราวตามมาตรา 75 โดยออกแบบสำหรับใช้งานภายในองค์กร รองรับการใช้งานผ่าน Web Browser, Google Apps Script และ Google Sheets

ระบบถูกพัฒนาให้รองรับการทำงานแบบ Real-Time, Multi-Device และสอดคล้องกับหลักการ PDPA โดยไม่จัดเก็บข้อมูลพนักงานไว้บน GitHub

---

## Main Features

### Employee Self Service

* Login ด้วยรหัสพนักงาน
* ดูสถานะการทำงานของตนเอง
* เปลี่ยนสถานะรายวัน
* บันทึกข้อมูลเข้าสู่ระบบกลาง
* ดูสรุปจำนวนวัน On / Off / ลา

### Dashboard

* แสดงภาพรวมพนักงานทั้งหมด
* Filter ตาม

  * บริษัท
  * หน่วยงาน
  * ฝ่าย
  * ส่วน
  * แผนก
* แสดง KPI

  * จำนวนพนักงาน
  * จำนวนวันทำงาน
  * จำนวน On
  * จำนวน Off
  * จำนวนลา
  * Attendance %

### Admin Management

Workflow 3 ขั้นตอน

1. ภาพรวม (Overview)
2. เลือกพนักงาน (Employee Selection)
3. ตารางรายวัน (Daily Matrix)

รองรับ

* เปลี่ยนสถานะรายวัน
* Bulk Update
* Reset Selected Employees
* Reset ทั้งระบบ
* Default Status = On
* Export รายงาน

### System Admin

รองรับ

* เพิ่มพนักงาน
* แก้ไขข้อมูลพนักงาน
* ปิดการใช้งานพนักงาน
* จัดการรหัสผ่านผู้ดูแล
* ตั้งค่า LINE Notification
* ตั้งค่าช่วงเวลาใช้งานระบบ

---

## Architecture

GitHub Pages

↓

Web Application (index.html)

↓

Google Apps Script (Code.gs)

↓

Google Sheets Database

↓

LINE OA Notification

---

## Database Structure

### Employees

Master Data พนักงาน

| Field    |
| -------- |
| EmpID    |
| Name     |
| Company  |
| Group    |
| Division |
| Section  |
| Dept     |
| Role     |
| Active   |

### Attendance

ข้อมูลสถานะรายวัน

| Field  |
| ------ |
| EmpID  |
| Date   |
| Status |

Status

* On
* Off
* พร.
* กิจ
* ป่วย

### Config

| Key               |
| ----------------- |
| DEFAULT_STATUS    |
| ADMIN_PIN_HR      |
| ADMIN_PIN_OPS     |
| ADMIN_PIN_ACC     |
| ADMIN_PIN_SYSTEM  |
| LINE_TO           |
| AUTO_UPDATE_GROUP |
| LOCK_SCHEDULE     |

`LOCK_SCHEDULE` เก็บ JSON กำหนดช่วงวันที่/เวลาห้ามแก้ไขข้อมูล ที่ System Admin ตั้งจากหน้าเว็บ (แท็บ ⚙ System Admin)
รูปแบบ: `{"enabled":true,"startDate":"2026-07-20","endDate":"2026-07-25","startTime":"08:00","endTime":"17:00","message":"..."}`
ฝั่ง Code.gs ต้องรองรับ action `setLockSchedule` (บันทึกค่า `schedule` ลง Config key นี้เป็น JSON)
และให้ `getAll` คืนค่ากลับมาใน `config.lockSchedule` ด้วย — ระหว่างช่วงที่กำหนด ทุกคนจะแก้ไขข้อมูลไม่ได้
จนกว่า System Admin จะกดปลดล็อคจากหน้าเว็บ

### AuditLog

บันทึกการเปลี่ยนแปลง

* เวลา
* ผู้แก้ไข
* รายการที่เปลี่ยน
* ค่าเดิม
* ค่าใหม่

---

## Export Report

รองรับการ Export Excel สำหรับผู้บริหาร

ข้อมูลประกอบด้วย

* บริษัท
* หน่วยงาน
* ฝ่าย
* ส่วน
* แผนก
* ตำแหน่ง
* สถานะรายวัน

พร้อม

* ตารางเส้น Grid ครบ
* รูปแบบพร้อมนำเสนอ
* แสดงสถานะเป็นข้อความจริง

ตัวอย่าง

* On
* Off
* พร.
* กิจ
* ป่วย

---

## PDPA Compliance

เพื่อความปลอดภัยของข้อมูลพนักงาน

GitHub Repository จะไม่จัดเก็บ

* รายชื่อพนักงาน
* รหัสพนักงาน
* ข้อมูลสังกัด
* Token ต่าง ๆ

ข้อมูลทั้งหมดถูกจัดเก็บภายใน Google Sheets เท่านั้น

LINE Channel Access Token ถูกจัดเก็บใน

Apps Script Script Properties

ไม่จัดเก็บใน HTML หรือ GitHub Repository

---

## Real-Time Synchronization

ระบบใช้ Google Sheets เป็นฐานข้อมูลกลาง

เมื่อมีการแก้ไขจากเครื่องใดก็ตาม

ข้อมูลจะถูกบันทึกเข้าสู่ Google Sheet และแสดงผลบนทุกอุปกรณ์

รองรับ Auto Refresh

ทุก 30 วินาที

---

## Notification

รองรับการแจ้งเตือนผ่าน

### LINE Official Account

แจ้งเตือนเมื่อ

* พนักงานกดบันทึกสถานะ
* Admin แก้ไขข้อมูล
* เปลี่ยนสถานะสำคัญ

### Email Notification

สามารถกำหนดผู้รับได้จากหน้าระบบ

---

## Default Configuration

DEFAULT_STATUS = On

AUTO_UPDATE_GROUP = FALSE

ระบบจะไม่เปลี่ยน Group ID อัตโนมัติ

เพื่อป้องกันการส่งข้อมูลไปยังกลุ่มผิดพลาด

---

## Technology Stack

Frontend

* HTML5
* CSS3
* Vanilla JavaScript

Backend

* Google Apps Script

Database

* Google Sheets

Notification

* LINE Official Account Messaging API
* Email (Google Apps Script)

---

## Version

TBS 2026 Production Release

Latest Update:

* Employee Master stored in Google Sheets
* PDPA Safe Architecture
* Executive Excel Report
* Department Filter
* Employee Management
* Real-Time Sync
* LINE OA Integration
* Audit Log Support

Developed for Siam Motors Logistics (SML)
