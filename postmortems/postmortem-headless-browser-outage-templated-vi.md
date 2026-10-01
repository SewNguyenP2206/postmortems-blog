---
title: "Worker thu thập dữ liệu sản phẩm – Playwright liên tục khởi động lại do OTel bị chèn ngầm"
date: "2026-09-25"
language: vi
translation: "postmortem-headless-browser-outage-templated"
severity: "P1"
status: "resolved"
duration: "Khoảng 4–5 giờ (ước tính, chưa được ghi nhận chính xác; xem Hạng mục hành động)"
services:
  - "Product Data Worker"
  - "Tự động hóa trình duyệt không giao diện (Playwright/Chromium)"
author: "Nhóm Backend / Platform"
tags:
  - "kubernetes"
  - "eks"
  - "opentelemetry"
  - "admission-webhook"
  - "headless-browser"
  - "playwright"
summary: "Một lần nâng cấp add-on không liên quan khiến mutating webhook của Kubernetes âm thầm chèn OpenTelemetry auto-instrumentation khi pod khởi động lại, làm renderer Chromium rơi vào vòng lặp crash và khiến các tác vụ thu thập dữ liệu thất bại."
---

## Tổng quan sự cố

Ngày 2026-09-25, bắt đầu khoảng 10:00, một worker dùng thư viện tự động hóa trình duyệt không giao diện (Playwright/Chromium) để tải trang sản phẩm từ các website bên thứ ba đột nhiên khiến mọi tác vụ thất bại với lỗi timeout. Ban đầu, sự cố trông giống vấn đề mạng bên ngoài, nhưng nguyên nhân thực sự là một admission webhook của Kubernetes, được cài cùng add-on quan sát do nhà cung cấp quản lý, đã âm thầm thêm các annotation auto-instrumentation vào workload trong lần khởi động lại thường lệ vào đêm trước. Phần instrumentation bị treo khi khởi động, kéo theo quy trình quản lý tiến trình con của trình duyệt và khiến renderer liên tục crash rồi khởi động lại.

## Dòng thời gian

| Thời gian (UTC) | Sự kiện |
|---|---|
| ~23:29 (ngày hôm trước) | Pod được khởi động lại trong đợt bảo trì không liên quan; đây là lần đầu pod được tạo lại kể từ sau khi add-on được nâng cấp. Mutating admission webhook âm thầm chèn 8 annotation auto-instrumentation vào cấu hình pod. |
| 10:00 | Tác vụ thu thập dữ liệu đầu tiên sau lần khởi động lại thất bại với `Content fetch failed` / `Navigation timeout after 60s`. |
| — | `curl` trực tiếp tới URL đích từ trong pod vẫn thành công (200 OK), loại trừ vấn đề mạng hoặc egress. |
| — | Cùng mã nguồn chạy bình thường ở môi trường thấp hơn, xác nhận vấn đề chỉ xảy ra ở môi trường bị ảnh hưởng. |
| — | Phát hiện một dòng log lặp lại: lời gọi dò tìm tài nguyên AWS thất bại, chỉ xuất hiện ở môi trường này. |
| — | Lần lượt loại trừ giới hạn tài nguyên, sandbox/runtime và phiên bản browser binary. |
| — | Khởi chạy browser binary thủ công, bên ngoài thư viện tự động hóa, vẫn hoạt động bình thường. |
| — | Chỉ tái hiện được khi chạy đúng luồng xử lý của thư viện tự động hóa: cây tiến trình cho thấy hàng chục renderer con tồn tại rất ngắn, liên tục được tạo rồi chết (vòng lặp crash, không phải chỉ bị treo). |
| — | Tắt auto-instrumentation để thử nghiệm; tác vụ lập tức chạy thành công. |
| — | Truy xuất Kubernetes API audit log để xác nhận chính xác sự kiện và thời điểm mutation. |
| Cùng ngày | Áp dụng workaround bằng annotation override và xác nhận dịch vụ ổn định trở lại. |

## Nguyên nhân gốc rễ

Một add-on quan sát do nhà cung cấp cloud quản lý (được cài thông qua cơ chế EKS add-on) cung cấp **mutating admission webhook** tự động chèn OpenTelemetry instrumentation vào mọi pod được tạo lại trong các namespace mà webhook áp dụng. Mặc định, webhook bật cho mọi ngôn ngữ được hỗ trợ mà không yêu cầu chủ workload opt-in.

Workload này chưa được deploy hoặc khởi động lại kể từ trước lần nâng cấp add-on gần nhất, nên chưa đi qua webhook cho đến khi có một lần restart thường lệ, không liên quan. Khi đó:

1. Webhook thêm annotation bật auto-instrumentation cho bốn ngôn ngữ, trong đó workload chỉ thực sự dùng một ngôn ngữ.
2. Một init container và OpenTelemetry SDK được tự động đưa vào runtime của ứng dụng.
3. Khi khởi động, cloud-resource detector của SDK gọi cloud API để lấy metadata nhưng nhận `403 Forbidden` (nguyên nhân gốc của lỗi 403 vẫn đang được điều tra; xem Hạng mục hành động).
4. Do lời gọi này không hoàn tất, một phần xử lý tiến trình con của instrumentation bị kẹt.
5. Mỗi lần ứng dụng khởi chạy Chromium, renderer lập tức crash sau khi được tạo. Browser liên tục tạo renderer mới theo vòng lặp retry có backoff; hàng chục PID khác nhau xuất hiện trong vài giây nhưng không tiến trình nào tồn tại. Việc điều hướng trang không bao giờ hoàn tất nên timeout ở cấp ứng dụng luôn xảy ra.

Audit log ghi nhận patch của webhook (các định danh đã được ẩn):

```json
{
  "requestURI": "/apis/apps/v1/namespaces/<namespace>/deployments/<service-name>",
  "verb": "patch",
  "user": { "username": "<engineer-identity>" },
  "requestObject": {
    "spec": { "template": { "metadata": { "annotations": {
      "kubectl.kubernetes.io/restartedAt": "<timestamp>"
    } } } }
  },
  "annotations": {
    "mutation.webhook.admission.k8s.io/round_0_index_4": {
      "configuration": "<observability-addon>-mutating-webhook-configuration",
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

Request ban đầu do kỹ sư thực hiện chỉ chứa annotation `restartedAt` thông thường; mọi thay đổi còn lại đều do webhook thêm vào.

## Ảnh hưởng

- **Người dùng bị ảnh hưởng:** Không áp dụng — đây là worker nội bộ để nạp dữ liệu, làm giàu danh mục sản phẩm; không nằm trên luồng request hướng tới người dùng.
- **Ảnh hưởng doanh thu:** Không thể định lượng trực tiếp; tác động phía sau chỉ giới hạn ở việc dữ liệu danh mục được cập nhật chậm hơn.
- **Tình trạng SLA:** Trong SLA (pipeline batch nội bộ, không vi phạm SLA hướng tới khách hàng).

## Phát hiện

- **Thời gian phát hiện trung bình (MTTD):** Không có cảnh báo tự động; sự cố được phát hiện khi rà soát thủ công sau khi thấy tác vụ lỗi trong log.
- **Thời gian xử lý trung bình (MTTR):** Khoảng 4–5 giờ từ lần đầu quan sát thấy lỗi đến khi xác nhận bản sửa (ước tính; xem Hạng mục hành động về cải thiện việc đo thời gian cho pipeline này).

## Khắc phục

1. Xác nhận nguyên nhân gốc bằng cách tắt OpenTelemetry auto-instrumentation (`OTEL_SDK_DISABLED=true`) để thử nghiệm; các tác vụ lập tức chạy thành công.
2. Áp dụng bản sửa lâu dài: thêm annotation override tường minh (`appsignals.k8s.aws/auto-annotate-<language>=false`) vào cấu hình Deployment cho ba ngôn ngữ không dùng, chỉ giữ lại instrumentation thực sự cần thiết.
3. Triển khai thay đổi bằng `kubectl rollout restart` và xác nhận các init container dành cho ngôn ngữ không dùng không còn xuất hiện trong pod mới.
4. Xác nhận các tác vụ thu thập dữ liệu chạy bình thường sau rollout.

## Hạng mục hành động

| Hành động | Phụ trách | Hạn hoàn thành | Trạng thái |
|---|---|---|---|
| Tắt tường minh annotation auto-instrumentation cho các ngôn ngữ không dùng trên từng workload trong version control, thay vì phụ thuộc vào mặc định của add-on | Backend | — | ✅ Đã xong (workload này) |
| Tìm nguyên nhân gốc của lỗi `403` từ cloud-resource detector (IAM/permissions hoặc network policy) | Platform | — | ⏳ Đang chờ |
| Rà soát các workload khác dùng headless browser hoặc runtime tạo nhiều tiến trình để tìm cùng nguy cơ tiềm ẩn | Platform | — | ⏳ Đang chờ |
| Thêm cảnh báo cho admission-webhook mutation tự ý bổ sung instrumentation vào cấu hình workload ngoài deploy pipeline của workload đó | Platform | — | ⏳ Đang chờ |
| Bổ sung đo thời gian và cảnh báo tỷ lệ job thất bại của pipeline để lần sau đo MTTD/MTTR chính xác hơn | SRE | — | ⏳ Đang chờ |
| Ghi lại tình huống này trong runbook nội bộ (webhook tự chèn instrumentation khi pod được tạo lại; workload lâu ngày không restart vẫn có thể bị ảnh hưởng hồi tố sau khi add-on được nâng cấp) | Platform | — | ⏳ Đang chờ |

## Bài học rút ra

1. Một hành động thường lệ, không liên quan (khởi động lại pod) có thể kích hoạt thay đổi hành vi do một lần nâng cấp add-on hạ tầng từ nhiều tuần trước, dù ứng dụng không hề đổi mã hay cấu hình. Vì vậy, “thay đổi gần đây nhất” và “sự kiện kích hoạt” có thể cách xa nhau cả về thời gian lẫn quan hệ nhân quả.
2. Add-on quan sát được quản lý và mặc định tự mutation workload là rủi ro thực sự với các workload chạy runtime nhiều tiến trình (headless browser hoặc ứng dụng fork/exec tiến trình con). Instrumentation khởi động bị treo có thể biểu hiện thành vòng lặp crash của tiến trình con, trông không giống sự cố instrumentation.
3. Workload lâu ngày không deploy hoặc restart có thể âm thầm tích lũy rủi ro từ những thay đổi hạ tầng trong thời gian đó. Tác động chỉ lộ ra ở lần tạo lại tiếp theo, có thể xảy ra muộn hơn nhiều và trông như không liên quan.
4. Kubernetes API audit log là công cụ có giá trị nhất để xác định nguyên nhân; nếu không có log này, sẽ rất khó kết luận sự cố một cách chắc chắn.