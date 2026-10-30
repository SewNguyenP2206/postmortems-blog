---
title: "API Gateway – Lỗi 423 do xác minh IP sau khi đổi đường đi request"
date: "2026-10-28"
language: vi
translation: "postmortem-api-gateway-ip-verification"
severity: "P1"
status: "resolved"
duration: "Vài giờ; thời điểm khôi phục chính xác cần bổ sung"
services: ["User service", "API Gateway / VPC Link", "Application Load Balancer"]
author: "Engineering team"
tags: ["api-gateway", "ip-verification", "networking", "production"]
summary: "Sau khi chuyển DNS từ Application Load Balancer sang API Gateway, user service nhận diện sai IP nguồn qua đường VPC Link và trả lỗi 423 cho endpoint kiểm tra quyền truy cập tổ chức."
---

## Tổng quan sự cố

Ngày 28/10/2026, sau khi chuyển DNS của API production từ Application Load Balancer sang API Gateway HTTP API qua VPC Link, người dùng gặp lỗi 423 cùng thông báo “IP hiện tại không thể truy cập” khi gọi `/user/api/organization/access`.

Endpoint `/user/api/health` vẫn trả về 200 vì không đi qua logic xác minh IP. Sự cố được xử lý bằng hotfix logic xác minh IP trong user service ngay trong đêm. Thời điểm khôi phục chính xác và số khách hàng bị ảnh hưởng cần được bổ sung.

## Dòng thời gian

| Thời gian (ICT, UTC+7) | Sự kiện |
| --- | --- |
| ~18:50 | Chuyển DNS từ Application Load Balancer sang API Gateway HTTP API qua VPC Link. `/user/api/health` vẫn trả 200. |
| Sau đó | Người dùng production gặp lỗi 423 tại `/user/api/organization/access`; user service nhận một địa chỉ nguồn khác với IP người dùng. |
| Chiều tối | Loại trừ WAF và proxy/VPN phía trình duyệt: WAF trả 403, không phải lỗi 423 từ ứng dụng. |
| 19:54 | Access log API Gateway xác nhận gateway nhận đúng IP nguồn của request. |
| ~20:39 | Thử ghi đè `X-Forwarded-For` bằng parameter mapping nhưng HTTP API từ chối thao tác này trên header. |
| Trong đêm | Sửa logic xác minh IP trong user service và triển khai hotfix; lỗi được khắc phục. Giờ khôi phục chính xác cần bổ sung. |

## Nguyên nhân gốc rễ

Sự cố xảy ra do hai điều kiện kết hợp:

1. **Cấu hình staging khác production:** tính năng xác minh IP bị tắt ở staging nhưng vẫn bật ở production. Vì vậy, bài kiểm tra staging không phát hiện lỗi.
2. **Đường đi của request thay đổi:** trước đây request đi từ trình duyệt qua Application Load Balancer đến user service. Sau thay đổi, request đi qua API Gateway và VPC Link trước khi đến load balancer. Địa chỉ nguồn mà user service nhìn thấy không còn là IP người dùng.
3. **Logic xác minh phụ thuộc địa chỉ nguồn của kết nối:** user service so sánh địa chỉ đó với whitelist và trả 423 khi không khớp.

API Gateway vẫn nhận diện đúng IP nguồn của request, như được xác nhận trong access log. HTTP API không cho phép ghi đè `X-Forwarded-For`; mapping một header riêng `X-Client-IP` là hướng có thể dùng để chuyển IP này đến backend. Tuy nhiên, cần xác nhận user service hiện đọc IP từ header hoặc nguồn nào sau hotfix.

Một chi tiết chưa được giải thích đầy đủ là địa chỉ IP mà user service ghi nhận. Cần đối chiếu `X-Forwarded-For`, `X-Client-IP` và địa chỉ kết nối (`remoteAddr`) trong log để xác định chính xác nguồn.

## Ảnh hưởng

- **Người dùng bị ảnh hưởng:** người dùng production đi qua API mới và gặp logic xác minh IP tại `/user/api/organization/access`.
- **Triệu chứng:** endpoint trả 423 và giao diện báo IP hiện tại không thể truy cập.
- **Số khách hàng bị ảnh hưởng:** cần bổ sung.
- **Thời gian ảnh hưởng:** từ khoảng 18:50 ICT ngày 28/10 đến khi hotfix được triển khai trong đêm; giờ kết thúc chính xác cần bổ sung.
- **Ảnh hưởng doanh thu và SLA:** chưa có số liệu xác nhận.

## Phát hiện và chẩn đoán

| Giả thuyết | Kết quả |
| --- | --- |
| WAF chặn request | Loại trừ. WAF trả 403; lỗi thực tế là 423 từ ứng dụng. |
| Proxy/VPN phía trình duyệt làm đổi IP | Không đủ bằng chứng; sự cố bắt đầu đúng lúc thay đổi đường đi request. |
| API Gateway nhận sai IP người dùng | Loại trừ. Access log ghi nhận đúng IP nguồn của request. |
| Ghi đè `X-Forwarded-For` qua parameter mapping | Không thực hiện được trên HTTP API do header này bị hạn chế. |
| Chuyển IP qua header riêng `X-Client-IP` | Khả thi trên HTTP API; cần xác nhận user service sử dụng header nào sau hotfix. |

Health check trả 200 không phát hiện sự cố vì endpoint này không chạy qua logic xác minh IP. Ngoài ra, user service chưa ghi đủ thông tin header và địa chỉ kết nối để xác định IP nào được dùng trong phép kiểm tra.

## Khắc phục

1. Sửa logic xác minh IP trong user service để không phụ thuộc vào IP nguồn của kết nối qua VPC Link, sau đó triển khai hotfix production.
2. Thêm mapping `X-Client-IP` từ IP nguồn mà API Gateway nhận được; giữ mapping `Host` hiện có.
3. Xác nhận user service đọc IP từ nguồn nào và đảm bảo chỉ tin cậy header được thiết lập bởi gateway đáng tin cậy.

## Hạng mục hành động

| Hành động | Phụ trách | Hạn hoàn thành | Trạng thái |
| --- | --- | --- | --- |
| Bật xác minh IP ở staging giống production, hoặc khai báo rõ và review mọi khác biệt cấu hình | Team dev | TBD | ⏳ Cần thực hiện |
| Thêm test end-to-end qua API Gateway → VPC Link → load balancer → user service khi xác minh IP được bật | Team dev | TBD | ⏳ Cần thực hiện |
| Ghi log `X-Forwarded-For`, `X-Client-IP` và `remoteAddr` trong user service | Team dev | TBD | ⏳ Cần thực hiện |
| Giới hạn load balancer chỉ nhận traffic từ Security Group của VPC Link để tránh truy cập trực tiếp và giả mạo header | Team infra | TBD | ⏳ Cần thực hiện |
| Thêm synthetic check cho endpoint đi qua logic xác minh IP, không chỉ `/user/api/health` | Team infra | TBD | ⏳ Cần thực hiện |
| Dùng checklist đổi DNS/kiến trúc production, bao gồm kiểm thử môi trường tương đương và kế hoạch rollback | Team infra | TBD | ⏳ Cần thực hiện |
| Duy trì access log API Gateway với IP nguồn, status và latency | Team infra | TBD | ⏳ Cần thực hiện |
| Xác nhận số khách hàng bị ảnh hưởng, thời điểm khôi phục và owner/hạn chót cụ thể | Team dev / infra | TBD | ⏳ Cần thực hiện |

## Bài học rút ra

1. Staging chỉ phản ánh production nếu các cơ chế có thể làm hỏng request, như xác minh IP, được cấu hình tương đương.
2. Thêm API Gateway và VPC Link có thể làm thay đổi địa chỉ nguồn mà backend nhìn thấy. Cần kiểm tra lại mọi logic phụ thuộc IP khi thay đổi kiến trúc mạng.
3. Không thể dùng health check đơn giản để đại diện cho luồng nghiệp vụ có xác minh IP; cần synthetic check cho endpoint thực tế.
4. Header chuyển tiếp IP chỉ đáng tin khi backend chỉ nhận request từ gateway được kiểm soát và không cho phép truy cập trực tiếp để giả mạo header.
5. Access log của gateway giúp xác nhận điểm đầu của request, nhưng log tại backend cũng cần ghi nhận các header và địa chỉ kết nối liên quan để chẩn đoán xuyên suốt.
