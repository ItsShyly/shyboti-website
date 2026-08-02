import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles/edit-panel.css'

const app = createApp(App)
app.use(router)
app.mount('#app')
