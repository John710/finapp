import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
  {
    path: '/setup',
    redirect: '/register'
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('../views/RegisterView.vue'),
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

  // Authenticated users have no business on public auth pages.
  if (auth.isAuthenticated && (to.path === '/login' || to.path === '/register')) {
    next('/')
    return
  }

  // Check setup state on the first guarded navigation and when accessing auth pages.
  if (!auth.setupChecked || to.path === '/login' || to.path === '/register') {
    await auth.checkSetup()
  }

  // If no user exists yet, force registration.
  if (auth.setupRequired && to.path !== '/register') {
    next('/register')
    return
  }

  // If setup is already done, registration page is not reachable.
  if (!auth.setupRequired && to.path === '/register') {
    next('/login')
    return
  }

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    next('/login')
  } else {
    next()
  }
})

export default router
