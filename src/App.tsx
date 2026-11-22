import { BookOpen, ChevronDown, ChevronRight, CircleHelp, Clock3, Command, Library, Search, Settings2, StickyNote } from 'lucide-react'
import { PdfLibrary } from './features/pdf/PdfLibrary'

function App() {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home" aria-label="Marginalia 首页">
          <span className="brand-mark"><BookOpen size={17} strokeWidth={1.8} /></span>
          <span className="brand-name">marginalia<span className="brand-period">.</span></span>
        </a>

        <div className="workspace-switcher">
          <span className="workspace-avatar">M</span>
          <span className="workspace-name">我的工作区</span>
          <ChevronDown size={14} className="muted-icon" />
        </div>

        <div className="nav-group">
          <p className="nav-heading">工作区</p>
          <button className="nav-item active"><Library size={16} /><span>文献库</span></button>
          <button className="nav-item" disabled><StickyNote size={16} /><span>我的笔记</span><span className="nav-soon">即将推出</span></button>
          <button className="nav-item" disabled><Clock3 size={16} /><span>最近阅读</span></button>
        </div>

        <div className="sidebar-bottom">
          <div className="storage-card">
            <div className="storage-top"><span>本地优先</span><span>阶段 1</span></div>
            <div className="storage-track"><span /></div>
            <p>PDF 与阅读数据将在后续阶段接入</p>
          </div>
          <button className="nav-item" disabled><CircleHelp size={16} /><span>帮助与反馈</span></button>
          <button className="nav-item" disabled><Settings2 size={16} /><span>设置</span></button>
          <div className="profile-row">
            <div className="profile-avatar">读</div>
            <div className="profile-copy"><strong>个人空间</strong><span>本地模式</span></div>
            <ChevronDown size={14} className="muted-icon" />
          </div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumb"><span>工作区</span><ChevronRight size={13} /><strong>文献库</strong></div>
          <div className="topbar-actions">
            <button className="search-trigger" disabled><Search size={15} /><span>搜索文献与笔记</span><kbd><Command size={10} /> K</kbd></button>
            <span className="topbar-divider" />
            <button className="help-button" aria-label="帮助"><CircleHelp size={17} /></button>
            <div className="profile-avatar small">读</div>
          </div>
        </header>

        <div className="content-wrap">
          <section className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-dot" />个人研究空间</div>
              <h1>让每一次阅读，<em>都有迹可循。</em></h1>
              <p className="welcome-copy">清晰浏览 PDF 原文，逐页查看提取结果，让阅读线索从此有处可寻。</p>
            </div>
            <div className="date-chip"><span className="date-dot" />你的私人阅读空间</div>
          </section>

          <PdfLibrary />
          <footer className="page-footer"><span>Marginalia <span className="footer-dot">·</span> 版本 0.1</span></footer>
        </div>
      </section>
    </main>
  )
}

export default App
