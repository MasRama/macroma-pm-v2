/*
 * Business-neutral presentational components for the browser: buttons, form
 * fields, segmented control, tabs, avatars, modal, drawer, dropdown, confirm,
 * dropzone. Props in, events out; nothing here fetches or knows a Feature.
 * Global classes they rely on (.btn, .panel, .h2, tokens) live in resources/macroma.css.
 */
export { default as AvatarStack } from './AvatarStack.vue';
export { default as CloseButton } from './CloseButton.vue';
export { default as ConfirmDialog } from './ConfirmDialog.vue';
export { default as CountBadge } from './CountBadge.vue';
export { default as DropdownMenu } from './DropdownMenu.vue';
export { default as PageHead } from './PageHead.vue';
export { default as SegmentedControl } from './SegmentedControl.vue';
export { default as SelectField } from './SelectField.vue';
export { default as ShellTopBar } from './ShellTopBar.vue';
export { default as TextArea } from './TextArea.vue';
export { default as TextField } from './TextField.vue';
export { default as TopCrumb } from './TopCrumb.vue';
export { default as UiAvatar } from './UiAvatar.vue';
export { default as UiButton } from './UiButton.vue';
export { default as UiDrawer } from './UiDrawer.vue';
export { default as UiDropzone } from './UiDropzone.vue';
export { default as UiIcon } from './UiIcon.vue';
export { default as UiModal } from './UiModal.vue';
export { default as UiTabs } from './UiTabs.vue';
export type { SegmentOption, SelectOption, TabOption } from './options';
export { ICONS, type IconName } from './icons';
export {
  formatAgo,
  formatAgoLong,
  formatDay,
  formatDayLabel,
  formatDayTime,
  formatLongDate,
  formatStamp,
  formatTime,
} from './dates';
export { initials, personColor, type PersonRef } from './people';
export { useEscape } from './useDismiss';
