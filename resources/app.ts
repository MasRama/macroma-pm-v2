import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './index.css';
import { createApp } from 'vue';
import App from '../src/app/App.vue';
import router from '../src/app/router';

createApp(App).use(router).mount('#app');
