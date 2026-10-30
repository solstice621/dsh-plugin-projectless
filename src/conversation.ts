/** Reuse the native Conversation composer while displaying the no-workspace selection. */
import { createElement as h, useMemo, useRef, useState } from 'react'
import { FISH_LOGO_PATH, FISH_LOGO_VIEWBOX, IconChevronDownOutlineRegular, IconFolderCloseRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

/** Optional-Session renderer with the plugin's localized no-workspace label. */
export type ProjectlessConversationProps = PropsRuntime<'main.conversation'> & PropsRenderFactories & PropsLocale<'projectless-chat'>

/**
 * Keep the native editor, model selection, permissions, mode picker, and input actions.
 * @param props - current Session, localization, and public Factory renderer.
 * @returns the centered blank-chat layout with an editable native composer.
 */
export function ProjectlessConversationPanel(props: ProjectlessConversationProps) {
  const t = props.t
  const Views = useMemo(() => (viewProps: ConversationViewsProps) => h(ProjectlessHero, { ...viewProps, noneLabel: t('none') }), [t])
  return h('div', {
    'data-projectless-conversation': '',
    style: { position: 'relative', display: 'flex', flexDirection: 'column', height: '100%',
      minWidth: 0, minHeight: 0, overflow: 'hidden', background: 'var(--dsw-alias-bg-base)' },
  }, props.renderFactorySlot('conversation.content', { variant: 'main', phase: 'hero', hero: false }, { slots: { views: Views } }))
}

function ProjectlessHero(props: ConversationViewsProps & { readonly noneLabel: string }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string>()
  const anchorRef = useRef<HTMLButtonElement>(null)
  const t = props.t
  const mark = props.renderSlot('conversation.hero.brand.mark', { size: 34 }, {
    fallback: h('svg', { width: 34, height: (34 * FISH_LOGO_VIEWBOX.height) / FISH_LOGO_VIEWBOX.width,
      viewBox: '0 0 ' + FISH_LOGO_VIEWBOX.width + ' ' + FISH_LOGO_VIEWBOX.height, 'aria-hidden': true },
    h('path', { d: FISH_LOGO_PATH, fill: 'currentColor' })),
  })
  return h('div', { className: 'dsh-projectless-hero' },
    h('style', null, `
      [data-projectless-conversation] [data-conversation-scroll] { justify-content: center; }
      .dsh-projectless-hero { flex: none; width: min(calc(100% - 32px), var(--dsh-composer-card-max-width)); box-sizing: border-box; padding: 0 8px; margin: 0 auto 8px; }
      .dsh-projectless-title { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 10px; margin-bottom: 32px; font-size: 26px; line-height: 32px; font-weight: 500; color: var(--dsw-alias-label-primary); }
      .dsh-projectless-preview { align-self: flex-start; border-radius: 999px; padding: 1px 7px; font-size: 12px; line-height: 18px; background: var(--dsw-alias-state-business-tertiary); color: var(--dsw-alias-label-primary-bluish); }
      .dsh-projectless-row { display: flex; align-items: center; gap: 2px; min-width: 0; }
      .dsh-projectless-chip { display: inline-flex; align-items: center; gap: 4px; min-height: 28px; border: 0; border-radius: 8px; padding: 0 8px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; font-weight: 500; cursor: pointer; }
      .dsh-projectless-chip:hover, .dsh-projectless-chip[aria-expanded=true] { background: var(--dsw-alias-interactive-bg-hover); }
      .dsh-projectless-options { margin-left: auto; }
    `),
    h('div', { className: 'dsh-projectless-title' }, mark,
    h('span', null, t('hero.headline')), h('span', { className: 'dsh-projectless-preview' }, t('hero.preview'))),
    h('div', { className: 'dsh-projectless-row' },
      h('button', { type: 'button', ref: anchorRef, className: 'dsh-projectless-chip',
        'aria-label': t('hero.chooseWorkspace'), 'aria-haspopup': 'menu', 'aria-expanded': open,
        'data-projectless-workspace-chip': '', onClick: () => { setOpen(value => !value) } },
      h(IconFolderCloseRegular, { size: 16 }), props.noneLabel, h(IconChevronDownOutlineRegular, { size: 12 })),
      props.renderSlot('conversation.hero.workspace', { open, anchorRef, onClose: () => { setOpen(false) },
        onPick: workspaceId => {
          setOpen(false)
          setError(undefined)
          void props.selectWorkspace(workspaceId).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) })
        } }),
      props.renderSlot('conversation.hero.agentPreset', {}),
      h('div', { className: 'dsh-projectless-options' }, props.renderSlot('conversation.hero.options', {}))),
    error === undefined ? null : h('div', { role: 'alert' }, error))
}
