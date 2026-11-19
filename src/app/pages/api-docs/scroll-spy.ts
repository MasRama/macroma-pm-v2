/**
 * The section the reader is on: the last one whose top has passed `line`, just
 * under the sticky top bar. The last sections of a page can never scroll up to
 * that line, so at the bottom of the page it is the last one.
 */
export function sectionAt(sections: Array<{ id: string; top: number }>, line: number, atBottom: boolean): string | undefined {
  if (sections.length === 0) return undefined;
  if (atBottom) return sections[sections.length - 1].id;
  let current = sections[0].id;
  for (const section of sections) if (section.top <= line) current = section.id;
  return current;
}

/** The element that scrolls `element`: its nearest scrolling ancestor, or the page. */
export function scrollerOf(element: Element): HTMLElement {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}
