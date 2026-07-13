**Comparison target**

- Source visual truth: `/tmp/codex-remote-attachments/019ef30f-430e-7d73-a573-d17ce2116097/776682EC-24F9-408C-A5E2-46EF96FD6E68/1-照片-1.jpg` through `5-照片-5.jpg`.
- Implementation target: `client/src/main.jsx` + `client/src/styles/app.css`, rendered by the production build.
- Intended viewport: 390 × 844, mobile portrait.
- Intended state: student essay result, beside-comment view and both comparison tabs.

**Evidence**

- Production build regenerated `client/dist/index.html` and assets successfully after the page changes.
- Browser visual capture is blocked in this environment: local backend processes are automatically reclaimed when their execution command ends; the in-app browser therefore cannot maintain a reachable local page or capture a screenshot. The public Tunnel was also unavailable during this QA pass.

**Findings**

- [P1] Visual render capture unavailable.
  Location: local preview / public Tunnel.
  Evidence: local `127.0.0.1:4000` returned connection refused after the host reclaimed the background process; public URL returned Cloudflare Tunnel 1033.
  Impact: a pixel-level comparison against the supplied mobile screenshots cannot be completed in this environment.
  Fix: run `bash start-tunnel.sh` from a persistent local terminal, then capture `/review/:essayId` as a logged-in student at 390 × 844.

**Required fidelity surfaces reviewed in code**

- Fonts and typography: retained PingFang SC / Microsoft YaHei stack; titles, body copy, annotation copy, and 11–16 px mobile utility labels now have dedicated hierarchy.
- Spacing and layout rhythm: 16–20 px cards, 14 px section rhythm, rounded mobile cards, fixed four-column action bar, and responsive two-to-one annotation layout are implemented.
- Colors and visual tokens: matched the reference’s pale mint header, bright green active states, blue annotation markers, red comments, and black pill-shaped Word export control.
- Image quality and asset fidelity: user-uploaded essay images are rendered at native aspect ratio with `object-fit: contain`; no generated or placeholder imagery was added.
- Copy and content: tabs and controls use the supplied reference terminology: 旁批、查看旁批对照、查看原图、原文润色提升对比、原文基础纠正对比、选为范文、分享好友、导出 PDF、导出 Word.

**Implementation checklist**

- [x] Add beside-comment / original-image switching.
- [x] Add two functional comparison states with color legend and copy actions.
- [x] Add structured suggestion card.
- [x] Make bottom toolbar match the four-action mobile pattern.
- [x] Preserve AI re-review through the header overflow menu.
- [ ] Capture and compare live mobile screenshots once a persistent preview is available.

**Follow-up polish**

- [P3] After live capture, tune line breaks and annotation density against a real multi-page handwritten essay.

final result: blocked
