import { Fragment, type CSSProperties, type ReactNode } from "react";
import { type Article, type Block, THEMES, DEFAULT_FOOTER,safeUrl, readingTime, articleOutline, sectionId } from "@/lib/article";
import { ReaderChecklist, SectionLink } from "./interactive-blocks";

export function inline(text: string): ReactNode[] {
  const result: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let from = 0, match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > from) result.push(text.slice(from, match.index));
    const token = match[0], key = match.index;
    if (token.startsWith("**")) result.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("*")) result.push(<em key={key}>{token.slice(1, -1)}</em>);
    else {
      const parts = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)!;
      const href = safeUrl(parts[2]);
      result.push(href ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{parts[1]}</a> : <Fragment key={key}>{parts[1]}</Fragment>);
    }
    from = match.index + token.length;
  }
  if (from < text.length) result.push(text.slice(from));
  return result;
}
export function BlockView({ block, articleKey }: { block: Block; articleKey?: string }) {
  if (block.type === "divider") return <hr className="article-divider" />;
  if (block.type === "image") return <figure><img src={safeUrl(block.url || "", true)} alt={block.text} loading="lazy" />{block.text && <figcaption>{block.text}</figcaption>}</figure>;
  if (block.type === "button") return <div className="article-button-wrap"><a className="article-button" href={safeUrl(block.url || "")} target="_blank" rel="noopener noreferrer">{block.text || "Открыть ссылку"}<span aria-hidden="true">↗</span></a></div>;
  if (block.type === "heading") return <h2 className="linked-heading">{inline(block.text)}{articleKey && <SectionLink id={sectionId(block.id)} />}</h2>;
  if (block.type === "summary") return block.text.trim() ? <section className="article-summary"><span className="summary-label">СУТЬ ЗА МИНУТУ</span><div>{inline(block.text)}</div></section> : null;
  if (block.type === "details") return <details className="article-details"><summary>{block.label || "Подробнее"}<span aria-hidden="true">+</span></summary><div>{inline(block.text)}</div></details>;
  if (block.type === "checklist") return <ReaderChecklist text={block.text} storageKey={articleKey ? "list:check:" + articleKey + ":" + block.id : undefined} />;
  if (block.type === "quote") return <blockquote>{inline(block.text)}</blockquote>;
  if (block.type === "list") return <ul>{block.text.split("\n").filter(Boolean).map((text, i) => <li key={i}>{inline(text.replace(/^[-•]\s*/, ""))}</li>)}</ul>;
  return <p>{inline(block.text)}</p>;
}
export function articleStyle(article: Article): CSSProperties {
  const theme = THEMES[article.theme] || THEMES.paper;
  return { "--paper": article.background||theme.bg, "--ink": theme.text, "--muted": theme.muted, "--accent": article.accent, "--article-font": article.font === "serif" ? "Georgia, 'Times New Roman', serif" : "'Arial', sans-serif", "--article-width": article.wide ? "860px" : "680px" } as CSSProperties;
}
export function ArticleView({ article, preview = false, summaryOnly = false }: { article: Article; preview?: boolean; summaryOnly?: boolean }) {
  const outline = articleOutline(article),footer=article.footer||DEFAULT_FOOTER;
  const blocks = summaryOnly ? article.blocks.filter((b) => b.type === "summary" && b.text.trim()) : article.blocks;
  return <article className={"article-view article-paper " + (preview ? "in-preview" : "")} style={articleStyle(article)}>
    <div className="article-inner">
      <header className={"article-heading align-" + article.alignment}>
        <div className="article-eyebrow"><span />МЕСТО ДЛЯ ВАШИХ ИСТОРИЙ</div>
        <h1>{article.title || "Название вашей истории"}</h1>
        {article.subtitle && <p className="article-subtitle">{article.subtitle}</p>}
        <div className="article-byline"><span className="author-initial">{(article.author || "А").slice(0, 1)}</span><span>{article.author || "Автор"}</span><span className="byline-dot">·</span><span>{readingTime(article)} мин чтения</span></div>
      </header>
      {article.cover && !summaryOnly && <figure className="article-cover"><img src={safeUrl(article.cover, true)} alt="" /></figure>}
      {!summaryOnly && outline.length > 1 && <details className="article-toc"><summary><span>В этой статье</span><span>Разделы · {outline.length} <span aria-hidden="true">⌄</span></span></summary><nav aria-label="Оглавление статьи">{outline.map((item, i) => <a key={item.id} href={"#" + item.id}><span>{String(i + 1).padStart(2, "0")}</span>{item.title}</a>)}</nav></details>}
      <div className="article-body">{blocks.map((block) => <div id={sectionId(block.id)} data-block-id={block.id} className={"reader-block"+(block.background||block.color?" colored-block":"")} style={{background: block.background,color:block.color,...(block.color?{"--ink":block.color,"--muted":block.color,"--accent":block.color}:{} )} as CSSProperties} key={block.id}><BlockView block={block} articleKey={preview ? undefined : article.id} /></div>)}</div>
      <ArticleEnding footer={footer}/>
    </div>
  </article>;
}

export function ArticleEnding({footer}:{footer:import('@/lib/article').ArticleFooter}){if(!footer.text&&!footer.mark&&!footer.buttons.length)return null;return <footer className="article-end custom-article-end">{footer.mark&&<span>{footer.mark}</span>}{footer.text&&<p>{footer.text}</p>}{footer.buttons.length>0&&<nav className="article-footer-buttons" aria-label="Ссылки автора">{footer.buttons.map((button,i)=><a key={i} href={safeUrl(button.url)} target="_blank" rel="noopener noreferrer">{button.label}</a>)}</nav>}</footer>;}
