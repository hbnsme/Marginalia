# 产品截图拍摄指南

三张图均从本地运行的 V1 页面拍摄。截图完成后再加入根 README，当前目录只有拍摄说明。

## 准备

1. 在候选目录运行 `pnpm install --frozen-lockfile` 和 `pnpm dev`。用全新的浏览器访客会话或独立配置文件打开 `http://localhost:5173`。三张图使用同一会话和站点地址，便于保留当天创建的演示记录。
2. 用桌面宽窗口，让「原文」和「中文译文」并排。浏览器视口宽度保持在 780 CSS 像素以上。截图只截网页内容，隐藏书签栏、浏览器账户、文件选择器、终端、开发者工具和系统通知。
3. 使用本目录的 [demo-reading.pdf](demo-reading.pdf)。两页均标注 Demonstration Document，英文正文为原创虚构内容，可随候选版公开。
4. 现有 `text-two-page.pdf` 可用于导入、翻页和抽取的预演，每页只有一句测试文字。`no-text-page.pdf` 是无文本层的图像测试夹具。正式截图使用本目录的独立演示文献。

## 01 · PDF 双栏阅读

1. 在首页点「导入第一份 PDF」，选择合成演示文献，关闭文件选择器后等待第 1 页渲染和文本提取完成。
2. 将阅读区滚动到能看到「原始 PDF」及下方「原文 / 中文译文」栏的位置。V1 的 PDF 画布在上方，原文与译文在下方并排。必要时适当缩小浏览器缩放，保留正文可读性。
3. 可点击首段旁的 PDF 定位图标展示段落与原页的联系。确认画面只含合成内容，保存为 `01-pdf-reading.png`。

## 02 · 段落翻译与批注

1. 保持同一份文献和第 1 页。在「原文语言」选择英语。
2. 无真实凭据的演示方案是单独启动仅绑定 `127.0.0.1:8788` 的本地演示代理，使用 V1 已有的 `createTranslationProxyServer` 与内存 SQLite，注入 `translateImpl`，仅对指定合成段落返回预先写好的示例译文。就绪检查可使用本地占位值，进程不加载 `.env.local`，不请求阿里云。仓库现有桌面测试代理只用于启动器检查，无法返回译文。本轮未创建或启动演示代理。
3. 演示代理就绪后，勾选「我知悉点击翻译会将所选段落提交给阿里云机器翻译」，在对应译文卡点「翻译此段」。界面的服务提示仍沿用 V1 的阿里云文案。若使用演示代理，必须在 README 图片说明中标明「本地示例译文，未调用阿里云」。若尚未准备演示代理，先留空这张图。
4. 回到同一原文段落，点「添加批注」，输入虚构内容，例如「这一段说明了观察条件，后续可用于对比。」点「保存批注」。等待批注预览和译文同时出现，保存为 `02-translation-and-note.png`。

## 03 · 阅读归档

1. 保持演示 PDF 打开。确认上一张图的批注已保存，再点文档工具栏的「我的抽屉」。
2. 抽屉顶部显示当前文档的记录总数。点「笔记」展示已保存的批注，也可点「译文」确认示例译文已归档。选一个有内容的标签页拍摄，无需点击导出。
3. 检查抽屉、背景以及浏览器边缘仅展示演示数据，保存为 `03-reading-archive.png`。

## 根 README 引用

三张图存在后，在根 README 的「产品截图」章节用相对路径引用。按实际画面选择替代文本，并在图下说明演示译文的来源。

```markdown
![PDF 页面与原文、译文阅读区](screenshots/01-pdf-reading.png)

![同一段落的示例译文与已保存批注](screenshots/02-translation-and-note.png)

示例译文由本地演示代理返回，未调用阿里云。

![我的抽屉中的演示阅读记录](screenshots/03-reading-archive.png)
```
 
## 复现演示 PDF

使用 Python 和 ReportLab 4.4.9，在项目根目录运行以下文档生成片段。它仅生成演示 PDF。固定的 PDF 元数据使同一工具版本可重复生成相同字节。

<details>
<summary>展开文档生成片段</summary>

```python
from pathlib import Path
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

title = "Reading, Memory, and the Margins"
pages = [
    (
        "What a second reading keeps",
        [
            "In a made-up story, a reader returns to a quiet room and finds a blue cup on the windowsill. During the first reading, the cup seemed like part of the furniture. A week later, it is the detail that brings the room back: the cloudy glass, the open window, and the pause before someone speaks.",
            "Memory keeps a few details and supplies links between them. On the second reading, I can check those links against the page. Did the story say that the window was open, or did I imagine the cold because of the cloudy glass? The difference gives me a reason to read the paragraph again.",
            "A note in the margin can hold that question. I might write, 'Check when the window opens.' The note is short enough to leave the story in view. When I return, it tells me where my attention went and what I still need to look for.",
        ],
    ),
    (
        "What a translation makes visible",
        [
            "Suppose the story says that a voice 'carried' into the room. A translation might describe the voice as reaching the room, or it might suggest that the voice was loud. Both choices fit the word in isolation. The next sentence, where two people lower their voices, gives the reader evidence for choosing between them.",
            "I keep the original and the translation close together long enough to compare that choice. A useful annotation names the point of uncertainty: 'Does this describe distance or volume?' On another day I may prefer a different rendering, and the question will still help me explain why.",
            "At the end of the story, the blue cup is still on the windowsill. My annotations now record a question about the window and a choice about a voice. When I open the story again, those small records help me pick up the reading without having to remember every sentence.",
        ],
    ),
]

width, height = 510, 595
margin = 52
out = Path("screenshots/demo-reading.pdf")
pdf = canvas.Canvas(str(out), pagesize=(width, height), invariant=True, pageCompression=1)
pdf.setTitle(title)
pdf.setAuthor("")
pdf.setSubject("Original fictional text for an English reading demonstration")
body = ParagraphStyle("body", fontName="Times-Roman", fontSize=13, leading=19,
                      textColor=HexColor("#283630"))
for number, (heading, paragraphs) in enumerate(pages, start=1):
    pdf.setFillColor(HexColor("#356650"))
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawString(margin, 544, "Demonstration Document")
    pdf.setFillColor(HexColor("#182C24"))
    pdf.setFont("Times-Bold", 25)
    pdf.drawString(margin, 499, title)
    pdf.setFont("Times-Italic", 16)
    pdf.drawString(margin, 467, heading)
    pdf.setStrokeColor(HexColor("#B8CEC2"))
    pdf.line(margin, 450, width - margin, 450)
    top = 430
    for text in paragraphs:
        paragraph = Paragraph(text, body)
        _, block_height = paragraph.wrap(width - 2 * margin, height)
        paragraph.drawOn(pdf, margin, top - block_height)
        top -= block_height + 18
    assert top > 65
    pdf.line(margin, 53, width - margin, 53)
    pdf.setFont("Helvetica", 9)
    pdf.drawRightString(width - margin, 35, f"{number} / {len(pages)}")
    pdf.showPage()
pdf.save()
```

</details>
