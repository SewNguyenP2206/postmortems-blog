---
title: "Kubernetes CPU và Memory Requests/Limits: hiểu đúng để tránh OOM"
date: "2026-10-02"
category: "Kubernetes"
tags: ["kubernetes", "resources", "devops"]
author: "Phú Nguyễn"
summary: "Requests ảnh hưởng đến scheduling; limits đặt ngưỡng runtime. Hiểu khác biệt này giúp tránh throttling và OOMKilled."
---

## Requests và limits giải quyết hai việc khác nhau

Trong Kubernetes, `requests` và `limits` là cấu hình tài nguyên cho từng container trong Pod. Chúng không phải hai cách khai báo cùng một con số.

- **Request** là mức tài nguyên Kubernetes dùng để xếp Pod lên node. Scheduler cộng requests của các Pod để quyết định node còn đủ capacity hay không.
- **Limit** là ngưỡng tối đa container được phép dùng khi đang chạy.

Ví dụ:

```yaml
resources:
  requests:
    cpu: "250m"
    memory: "256Mi"
  limits:
    cpu: "1"
    memory: "512Mi"
```

Pod này yêu cầu scheduler dành capacity tương đương 250 millicores CPU và 256 MiB memory. Khi chạy, container có thể burst đến 1 CPU và 512 MiB nếu node còn tài nguyên.

## CPU limit có thể gây throttling

CPU là tài nguyên có thể chia sẻ. Khi container chạm CPU limit, kernel throttles tiến trình cho đến khi quota được làm mới. Container thường không bị dừng, nhưng latency có thể tăng dù node vẫn còn CPU rảnh.

Nếu service nhạy với latency, hãy theo dõi CPU throttling cùng với request rate và p95/p99 latency. Đặt limit quá sát mức tải đỉnh có thể làm service chậm trong burst ngắn. Một số nền tảng chọn không đặt CPU limit cho workload đó, nhưng cần bảo vệ node bằng requests, quota và giám sát phù hợp.

## Memory limit có thể kết thúc container

Memory không thể thu hồi bằng cách tạm ngưng container như CPU. Khi container vượt memory limit, kernel có thể kill tiến trình; Kubernetes thường hiển thị trạng thái `OOMKilled` rồi restart container theo policy của Pod.

Hãy đo working set dưới tải đại diện, tính đến heap, native memory và buffer, rồi để khoảng headroom hợp lý. Request quá thấp cũng khiến scheduler xếp quá nhiều workload lên cùng node, làm tăng rủi ro áp lực memory và eviction.

## Cách chọn giá trị ban đầu

1. Bắt đầu từ usage thực tế qua một chu kỳ tải đủ dài, không chỉ lấy một lần chạy thử.
2. Đặt request gần mức tiêu thụ bình thường mà workload cần để hoạt động ổn định.
3. Đặt memory limit cao hơn đỉnh quan sát được và kiểm tra hành vi khi vượt ngưỡng.
4. Với CPU, quyết định limit dựa trên mục tiêu latency và chính sách cluster; theo dõi throttling sau deploy.
5. Dùng `kubectl describe pod`, metrics của container và lịch sử restart để đối chiếu cấu hình với hành vi thật.

Giá trị tối ưu phụ thuộc workload. Requests giúp scheduler lập kế hoạch; limits bảo vệ runtime. Hãy đo cả hai và cập nhật theo dữ liệu production thay vì sao chép một bộ số dùng chung cho mọi service.