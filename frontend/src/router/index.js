import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
  {
    path: '/setup',
    name: 'Setup',
    component: () => import('../views/SetupView.vue'),
    meta: { public: true }
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/LoginView.vue'),
    meta: { public: true }
  },
  {
    path: '/',
    component: () => import('../views/LayoutView.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', name: 'Dashboard', component: () => import('../views/DashboardView.vue') },
      { path: 'transactions', name: 'Transactions', component: () => import('../views/TransactionsView.vue') },
      { path: 'accounts', name: 'Accounts', component: () => import('../views/AccountsView.vue') },
      { path: 'accounts/:id', name: 'AccountDetail', component: () => import('../views/AccountDetailView.vue') },
      { path: 'categories', name: 'Categories', component: () => import('../views/CategoriesView.vue') },
      { path: 'budgets', name: 'Budgets', component: () => import('../views/BudgetsView.vue') },
      { path: 'debts', name: 'Debts', component: () => import('../views/DebtsView.vue') },
      { path: 'recurring', name: 'Recurring', component: () => import('../views/RecurringView.vue') },
      { path: 'reports', name: 'Reports', component: () => import('../views/ReportsView.vue') },
      { path: 'tags', name: 'Tags', component: () => import('../views/TagsView.vue') },
      { path: 'settings', name: 'Settings', component: () => import('../views/SettingsView.vue') }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach(async (to, from, next) => {
  const auth = useAuthStore()
  if (!auth.checked) {
    await auth.checkAuth()
  }

  // Check if setup is required
  if (to.path !== '/setup') {
    try {
      const res = await fetch('/api/v1/auth/setup-required')
      if (res.ok) {
        const data = await res.json()
        if (data.required) {
          next('/setup')
          return
        }
      }
    } catch (e) {
      // ignore
    }
  }

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    next('/login')
  } else if (to.path === '/login' && auth.isAuthenticated) {
    next('/')
  } else {
    next()
  }
})

export default router
