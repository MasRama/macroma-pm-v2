/*
 * Browser boundary of the projects Feature: board, task detail, releases,
 * dashboard and activity pages, the components other features and the app
 * shell reuse, and the view types they render.
 */
export { default as ActivityPage } from './pages/ActivityPage.vue';
export { default as BoardPage } from './pages/BoardPage.vue';
export { default as DashboardPage } from './pages/DashboardPage.vue';
export { default as ReleasesPage } from './pages/ReleasesPage.vue';

export { default as ActivityItem } from './components/ActivityItem.vue';
export { default as BatchStrip } from './components/BatchStrip.vue';
export { default as BoardColumn } from './components/BoardColumn.vue';
export { default as BumpVersionMenu } from './components/BumpVersionMenu.vue';
export { default as MoveTaskModal } from './components/MoveTaskModal.vue';
export { default as NewProjectModal } from './components/NewProjectModal.vue';
export { default as NewTaskModal } from './components/NewTaskModal.vue';
export { default as PriorityBars } from './components/PriorityBars.vue';
export { default as ProjectTopBar } from './components/ProjectTopBar.vue';
export { default as StatusBar } from './components/StatusBar.vue';
export { default as StatusBlock } from './components/StatusBlock.vue';
export { default as StatusLegend } from './components/StatusLegend.vue';
export { default as TaskCard } from './components/TaskCard.vue';
export { default as TaskDetailModal } from './components/TaskDetailModal.vue';
export { default as TimelineNode } from './components/TimelineNode.vue';
export { default as VersionText } from './components/VersionText.vue';

export { formatVersion, greeting, projectColor, STATUS_BAR_COLOR, STATUS_COLOR, STATUS_LABEL, totalCount } from './format';
export * from './view';
