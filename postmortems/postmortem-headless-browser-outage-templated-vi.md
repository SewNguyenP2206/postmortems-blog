---

title: "[EKS] Pod worker cào dữ liệu – Playwright crash liên tục vì bị OTel Add-on 'úp sọt'"
date: "2026-09-25"
language: vi
translation: "postmortem-headless-browser-outage-templated"
severity: "P1"
status: "resolved"
duration: "Tầm 4-5 tiếng (đoán chừng thôi, chưa có track chính xác - xem Action Items)"
services:

* "Product Data Worker"
* "Playwright / Chromium"
author: "Phú Nguyễn"
tags:
* "kubernetes"
* "eks"
* "opentelemetry"
* "admission-webhook"
* "headless-browser"
* "playwright"
summary: "Một pha restart pod bình thường vô tình trigger cái mutating webhook của k8s, tự động chèn OTel auto-instrumentation vào. Cái này làm Chromium renderer kẹt trong crash loop, kéo theo toàn bộ job cào dữ liệu xịt hết."

---

## Tổng quan sự cố

Tầm 10h sáng 25/09/2026, con worker dùng Playwright để cào data từ các trang e-commerce tự nhiên tạch hàng loạt vì lỗi timeout. Thoạt nhìn cứ tưởng đứt mạng hay web bên kia chặn, debug một hồi mới lòi ra thủ phạm: một cái admission webhook của EKS. Cụ thể là đêm trước đó có đợt restart pod, cái webhook này (đi kèm với EKS add-on) đã nhét mấy cái annotation auto-instrumentation của OpenTelemetry vào workload. Khổ nỗi phần instrumentation này bị treo lúc khởi động, làm nguyên dàn process con của Chromium crash lên crash xuống liên tục.

## Dòng thời gian

| Thời gian (UTC) | Sự kiện |
| --- | --- |
| ~23:29 (đêm trước) | Tự nhiên restart pod do có bảo trì hạ tầng linh tinh. Đây là lần đầu tiên pod này được tạo lại kể từ đợt update add-on. Webhook lén nhét 8 cái annotation OTel vào. |
| 10:00 | Mấy job cào data đầu tiên trong ngày chết với lỗi `Content fetch failed` / `Navigation timeout after 60s`. |
| — | Nhảy thẳng vào pod `curl` thử ra ngoài thì HTTP 200 OK, không phải lỗi mạng hay bị egress chặn. |
| — | Bưng code về chạy thử ở staging/dev thì mượt. |
| — | Tăng limit RAM/CPU, tắt sandbox, đổi version trình duyệt -> Vẫn xịt. |
| — | Chạy Chromium chay bằng lệnh (không qua thư viện Playwright) -> Vẫn sống. |
| — | Tắt thử auto-instrumentation đi -> Job chạy pass xanh lè. |
| — | Mở log cloudtrail ra soi: không thấy có ai tác động đến cụm EKS. |
| — | Phải mò mẫm tới S3 chứa history của CloudTrail 1 năm trước ( Lúc tạo EKS (Kèm add-on) ) |
| — | Phát hiện nguyên nhân |
| Cùng ngày | Chốt hạ bằng cách thêm annotation chặn cái webhook này lại, service êm ái trở lại. |

## Nguyên nhân gốc rễ

Cái EKS add-on về observability (do AWS quản lý) có kèm một cái **mutating admission webhook**. Cứ pod nào restart/tạo mới trong namespace là nó tự động "khuyến mãi" thêm OpenTelemetry instrumentation.

Con worker này đã nằm im khá lâu, không deploy hay restart gì từ trước đợt update add-on gần nhất nên thoát nạn. Đến đêm qua có đợt bảo trì lôi nó ra restart thì dính chưởng. Quá trình như sau:

1. Webhook nhét annotation bật auto-instrument cho tận 4 ngôn ngữ (dù app thực tế chỉ dùng 1).
2. Pod vừa được restart lại thì dính chưởng, service bắt đầu sử dụng Playwright.
3. Mỗi khi app gọi Playwright khởi động Chromium, Chromium sẽ spawn ra các process renderer. Renderer chưa kịp làm gì thì bị phần instrumentation chặn lại. Pod không restart, DevOps không được cảnh báo 
4. Khách hàng ping rầm rầm rồi mới phát hiện.

Mọi người có thể nghía qua cái audit log này để thấy webhook nó làm trò gì (đã che tên dev):

```json
{
  "requestURI": "/apis/apps/v1/namespaces//deployments/",
  "verb": "patch",
  "user": { "username": "" },
  "requestObject": {
    "spec": { "template": { "metadata": { "annotations": {
      "kubectl.kubernetes.io/restartedAt": ""
    } } } }
  },
  "annotations": {
    "mutation.webhook.admission.k8s.io/round_0_index_4": {
      "configuration": "-mutating-webhook-configuration",
      "webhook": "mworkload.kb.io",
      "mutated": true
    },
    "patch.webhook.admission.k8s.io/round_0_index_4": {
      "patch": [
        { "op": "add", "path": "/spec/template/metadata/annotations/.../auto-annotate-dotnet", "value": "true" },
        { "op": "add", "path": "/spec/template/metadata/annotations/.../auto-annotate-java", "value": "true" },
        { "op": "add", "path": "/spec/template/metadata/annotations/.../auto-annotate-python", "value": "true" },
        { "op": "add", "path": "/spec/template/metadata/annotations/.../auto-annotate-nodejs", "value": "true" },
        { "op": "add", "path": "/spec/template/metadata/annotations/.../inject-dotnet", "value": "true" },
        { "op": "add", "path": "/spec/template/metadata/annotations/.../inject-java", "value": "true" },
        { "op": "add", "path": "/spec/template/metadata/annotations/.../inject-python", "value": "true" },
        { "op": "add", "path": "/spec/template/metadata/annotations/.../inject-nodejs", "value": "true" }
      ],
      "patchType": "JSONPatch"
    }
  }
}

```

Lệnh gốc ông dev gõ chỉ có mỗi cái `restartedAt`, toàn bộ phần dưới là webhook tự biên tự diễn.

## Ảnh hưởng

* **User:** Không ảnh hưởng. Đây là worker cào data ngầm để làm giàu danh mục sản phẩm, chả liên quan đến luồng request của user.
* **Doanh thu:** Khó đo lường, cơ bản là data sản phẩm bị update chậm vài tiếng.
* **SLA:** Vẫn trong SLA.

## Phát hiện

* **MTTD:** Phát hiện bằng cơm. Không có alert tự động.
* **MTTR:** Tầm 4-5 tiếng ngồi mò mẫm từ lúc thấy lỗi đến lúc chốt được bản fix (đang thiếu metrics đo vụ này).

## Khắc phục

1. Test nhanh: Set biến môi trường `OTEL_SDK_DISABLED=true` để tắt OTel đi.
2. Sửa tận gốc: Hardcode luôn annotation `appsignals.k8s.aws/auto-annotate-=false` vào Deployment cho 3 ngôn ngữ không dùng đến để dập tắt cái sự "nhiệt tình" của webhook.
3. `kubectl rollout restart` để tạo pod mới không có annotation.
4. Mở lại monitor, Playwright cào data phà phà trở lại.

## Hạng mục hành động

| Hành động | Phụ trách | Hạn hoàn thành | Trạng thái |
| --- | --- | --- | --- |
| Chặn tường minh vụ auto-instrumentation cho các ngôn ngữ không xài thẳng trong config, không dựa dẫm vào mặc định của add-on | Backend | — | ✅ Đã xong (cho worker này) |

## Bài học rút ra

1. **Hiệu ứng cánh bướm:** Một cú restart pod vô thưởng vô phạt có thể kích hoạt "bom nổ chậm" từ một đợt update hạ tầng từ nhiều tuần trước. "Sự kiện kích hoạt" và "thay đổi gốc" nhiều khi chả liên quan gì nhau.
2. **Nợ kỹ thuật ngầm:** App sống dai, lâu ngày không deploy thực ra đang âm thầm tích lũy rủi ro từ những thay đổi hạ tầng xung quanh. Đến lúc khởi động lại mới bung bét.
3. **Cứu tinh CloudTrail:** Không ngờ phải đến mức dò CloudTrail ( Trước đó DevOps cũng nản lắm rồi ~~ ).