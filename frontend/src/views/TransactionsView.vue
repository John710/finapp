<template>
  <div>
    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
      <h1 class="font-display text-2xl lg:text-3xl font-semibold tracking-tight">{{ $t('transactions.title') }}</h1>
      <div v-if="!isViewer" class="flex gap-2 self-start">
        <button class="bg-primary-500 hover:bg-primary-600 shadow-card text-white px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 transition-colors" @click="openModal()">
          <Icon name="plus" class="w-4 h-4" />
          {{ $t('common.add') }}
        </button>
        <button class="px-4 py-2 rounded-full border-0 bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2" @click="showImportModal = true">
          <Icon name="upload" class="w-4 h-4" />
          {{ $t('import.title') }}
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="bg-white dark:bg-slate-900 rounded-3xl p-4 shadow-card dark:shadow-card-dark mb-4 flex flex-wrap gap-3">
      <input v-model="filters.search" type="text" :placeholder="$t('common.search') + '...'" class="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-sm w-full lg:w-64 focus:outline-none focus:ring-2 focus:ring-primary-400" @input="debouncedApplyFilters" />
      <select v-model="filters.account_id" class="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm" @change="applyFilters">
        <option value="">{{ $t('accounts.title') }}</option>
        <option v-for="acc in accountsStore.accounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
      </select>
      <select v-model="filters.category_id" class="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm" @change="applyFilters">
        <option value="">{{ $t('categories.title') }}</option>
        <option v-for="cat in categoriesStore.categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
      </select>
      <select v-model="filters.type" class="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm" @change="applyFilters">
        <option value="">{{ $t('common.type') }}</option>
        <option value="income">{{ $t('categories.types.income') }}</option>
        <option value="expense">{{ $t('categories.types.expense') }}</option>
        <option value="transfer">{{ $t('transactions.types.transfer') }}</option>
      </select>
      <select v-model="filters.tag_id" class="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm" @change="applyFilters">
        <option value="">{{ $t('tags.title') }}</option>
        <option v-for="tag in tagsStore.tags" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
      </select>
      <button class="ml-auto px-3 py-2 rounded-full border-0 bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-slate-600 dark:text-slate-300" @click="resetFilters">
        {{ $t('common.reset_filters') }}
      </button>
    </div>

    <div v-if="transactionsStore.loading" class="bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark p-5 space-y-4">
      <div v-for="i in 6" :key="i" class="flex items-center gap-4">
        <BaseSkeleton height="2.5rem" width="2.5rem" />
        <div class="flex-1 space-y-2">
          <BaseSkeleton height="0.8rem" width="55%" />
          <BaseSkeleton height="0.6rem" width="35%" />
        </div>
        <BaseSkeleton height="1rem" width="5rem" />
      </div>
    </div>

    <div v-else-if="transactionsStore.transactions.length === 0" class="bg-white dark:bg-slate-900 rounded-3xl p-12 shadow-card dark:shadow-card-dark text-center">
      <p class="text-slate-500">{{ $t('transactions.empty') }}</p>
    </div>

    <div v-else>
      <!-- Desktop table -->
      <div class="hidden lg:block bg-white dark:bg-slate-900 rounded-3xl shadow-card dark:shadow-card-dark overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-transparent dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 uppercase tracking-wider text-xs">
            <tr>
              <th class="text-left px-5 py-3 font-medium">{{ $t('transactions.date') }}</th>
              <th class="text-left px-5 py-3 font-medium">{{ $t('categories.title') }}</th>
              <th class="text-left px-5 py-3 font-medium">{{ $t('common.name') }}</th>
              <th class="text-left px-5 py-3 font-medium">{{ $t('accounts.title') }}</th>
              <th class="text-left px-5 py-3 font-medium">{{ $t('tags.title') }}</th>
              <th class="text-right px-5 py-3 font-medium">{{ $t('transactions.amount') }}</th>
              <th class="px-5 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
            <tr v-for="t in transactionsStore.transactions" :key="t.id" class="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors" :class="t.parent_id ? 'bg-slate-50/60 dark:bg-slate-800/20' : ''">
              <td class="px-5 py-3 text-slate-500" :class="t.parent_id ? 'pl-10' : ''">{{ formatDate(t.date) }}</td>
              <td class="px-5 py-3">
                <span v-if="t.is_split" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                  {{ $t('transactions.split') }}
                </span>
                <span v-else-if="t.type === 'transfer' || (t.type === 'income' && t.transfer_to_account_id)" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  {{ $t('transactions.types.transfer') }}
                </span>
                <span v-else-if="t.category_name || t.category_id" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium" :class="categoryClass(t.type)">
                  <Icon v-if="t.category_icon" :name="t.category_icon" set="category" class="w-3.5 h-3.5" />
                  {{ t.category_name || '-' }}
                </span>
              </td>
              <td class="px-5 py-3">{{ formatNote(t) || '-' }}</td>
              <td class="px-5 py-3 text-slate-500">{{ t.account_name }}</td>
              <td class="px-5 py-3">
                <div class="flex flex-wrap gap-1">
                  <span v-for="tag in t.tags" :key="tag.id" class="px-1.5 py-0.5 rounded text-[10px] font-medium" :style="{ backgroundColor: tag.color || '#94a3b8', color: '#fff' }">{{ tag.name }}</span>
                </div>
              </td>
              <td class="px-5 py-3 text-right font-medium" :class="amountClass(t.type)">{{ formatAmount(t) }}</td>
              <td class="px-5 py-3">
                <div class="flex items-center gap-2">
                  <button v-if="!t.parent_id && !isViewer" class="text-slate-400 hover:text-primary-600 transition-colors" :aria-label="$t('transactions.attachments')" :title="$t('transactions.attachments')" @click="openAttachments(t.id)">
                    <Icon name="upload" class="w-4 h-4" />
                  </button>
                  <!-- Incoming transfer legs are managed through their source transfer row -->
                  <template v-if="!(t.type === 'income' && t.transfer_to_account_id) && !t.parent_id && !isViewer">
                    <button v-if="!t.is_split" class="text-slate-400 hover:text-primary-600 transition-colors" :aria-label="$t('common.edit')" :title="$t('common.edit')" @click="openEditModal(t)">
                      <Icon name="edit" class="w-4 h-4" />
                    </button>
                    <button class="text-slate-400 hover:text-danger-500 transition-colors" :aria-label="$t('common.delete')" :title="$t('common.delete')" @click="deleteTransaction(t.id)">
                      <Icon name="delete" class="w-4 h-4" />
                    </button>
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-sm text-slate-500">
          <span>{{ transactionsStore.total }} {{ $t('transactions.total') }}</span>
          <div v-if="pageCount > 1" class="flex items-center gap-2">
            <button :disabled="page <= 1" class="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed" :aria-label="$t('common.prev')" @click="changePage(page - 1)">
              <Icon name="arrowLeft" class="w-4 h-4" />
            </button>
            <span class="tabular-nums">{{ page }} / {{ pageCount }}</span>
            <button :disabled="page >= pageCount" class="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed" :aria-label="$t('common.next')" @click="changePage(page + 1)">
              <Icon name="arrowRight" class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <!-- Mobile cards -->
      <div class="lg:hidden space-y-3">
        <div v-for="t in transactionsStore.transactions" :key="t.id" class="bg-white dark:bg-slate-900 rounded-3xl p-4 shadow-card dark:shadow-card-dark">
          <div class="flex justify-between items-start mb-2">
            <span v-if="t.type === 'transfer' || (t.type === 'income' && t.transfer_to_account_id)" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              {{ $t('transactions.types.transfer') }}
            </span>
            <span v-else-if="t.category_name || t.category_id" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium" :class="categoryClass(t.type)">
              <Icon v-if="t.category_icon" :name="t.category_icon" set="category" class="w-3.5 h-3.5" />
              {{ t.category_name || '-' }}
            </span>
            <span class="font-medium" :class="amountClass(t.type)">{{ formatAmount(t) }}</span>
          </div>
          <p class="font-medium">{{ formatNote(t) || '-' }}</p>
          <p class="text-xs text-slate-500 mt-1">{{ formatDate(t.date) }} • {{ t.account_name }}</p>
          <div v-if="!(t.type === 'income' && t.transfer_to_account_id)" class="flex gap-2 mt-3">
            <button class="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300" :aria-label="$t('common.edit')" @click="openEditModal(t)">
              {{ $t('common.edit') }}
            </button>
            <button class="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300" :aria-label="$t('common.delete')" @click="deleteTransaction(t.id)">
              {{ $t('common.delete') }}
            </button>
          </div>
        </div>
        <div v-if="pageCount > 1" class="flex items-center justify-center gap-3 py-2 text-sm text-slate-500">
          <button :disabled="page <= 1" class="px-3 py-1.5 rounded-full bg-white dark:bg-slate-900 shadow-card dark:shadow-card-dark disabled:opacity-40 disabled:cursor-not-allowed" :aria-label="$t('common.prev')" @click="changePage(page - 1)">
            <Icon name="arrowLeft" class="w-4 h-4" />
          </button>
          <span class="tabular-nums">{{ page }} / {{ pageCount }}</span>
          <button :disabled="page >= pageCount" class="px-3 py-1.5 rounded-full bg-white dark:bg-slate-900 shadow-card dark:shadow-card-dark disabled:opacity-40 disabled:cursor-not-allowed" :aria-label="$t('common.next')" @click="changePage(page + 1)">
            <Icon name="arrowRight" class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <BaseModal v-model="showModal" width-class="max-w-md">
        <h2 class="font-display text-xl font-semibold mb-4">{{ editingId ? $t('common.edit') : $t('common.add') }}</h2>
        <form class="space-y-4" @submit.prevent="saveTransaction">
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('common.type') }}</label>
            <div class="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button type="button" class="flex-1 py-2 rounded-md text-sm font-medium transition-colors" :class="form.type === 'expense' ? 'bg-white dark:bg-slate-700 shadow-sm text-danger-500' : 'text-slate-500'" @click="form.type = 'expense'">{{ $t('categories.types.expense') }}</button>
              <button type="button" class="flex-1 py-2 rounded-md text-sm font-medium transition-colors" :class="form.type === 'income' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-500' : 'text-slate-500'" @click="form.type = 'income'">{{ $t('categories.types.income') }}</button>
              <button type="button" class="flex-1 py-2 rounded-md text-sm font-medium transition-colors" :class="form.type === 'transfer' ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-500' : 'text-slate-500'" @click="form.type = 'transfer'">{{ $t('transactions.types.transfer') }}</button>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ selectedAccount?.type === 'crypto' ? $t('transactions.quantity') : $t('transactions.amount') }}</label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{{ selectedAccount?.currency || baseCurrency }}</span>
              <input v-model.number="form.amount" type="number" :step="selectedAccount?.type === 'crypto' ? '0.00000001' : '0.01'" required class="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 focus:outline-none focus:ring-2 focus:ring-primary-400" />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('accounts.title') }}</label>
            <div class="flex gap-2">
              <select v-model="form.account_id" required class="flex-1 px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100">
                <option v-for="acc in accountsStore.accounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
              </select>
              <button type="button" class="shrink-0 p-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-primary-600" :title="$t('common.add')" @click="openQuickAccount('account_id')">
                <Icon name="plus" class="w-5 h-5" />
              </button>
            </div>
          </div>
          <div v-if="form.type !== 'transfer' && !useSplits">
            <label class="block text-sm font-medium mb-1">{{ $t('categories.title') }}</label>
            <div class="flex gap-2">
              <select v-model="form.category_id" class="flex-1 px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100">
                <option :value="null">-</option>
                <option v-for="cat in filteredCategories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
              </select>
              <button type="button" class="shrink-0 p-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-primary-600" :title="$t('common.add')" @click="showQuickCategory = true">
                <Icon name="plus" class="w-5 h-5" />
              </button>
            </div>
          </div>
          <div v-if="form.type !== 'transfer'">
            <label class="flex items-center gap-2 text-sm font-medium mb-2 cursor-pointer">
              <input v-model="useSplits" type="checkbox" class="rounded" />
              {{ $t('transactions.split_toggle') }}
            </label>
            <div v-if="useSplits" class="space-y-2">
              <div v-for="(row, i) in splitRows" :key="i" class="flex gap-2 items-center">
                <select v-model="row.category_id" class="flex-1 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm">
                  <option :value="null">-</option>
                  <option v-for="cat in filteredCategories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
                </select>
                <input v-model.number="row.amount" type="number" step="0.01" min="0" class="w-24 px-2 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100 text-sm" />
                <button v-if="splitRows.length > 1" type="button" class="text-slate-400 hover:text-danger-500 shrink-0" :aria-label="$t('common.delete')" @click="splitRows.splice(i, 1)">
                  <Icon name="cancel" class="w-4 h-4" />
                </button>
              </div>
              <div class="flex items-center justify-between text-xs">
                <button type="button" class="text-primary-600 font-medium" @click="splitRows.push({ category_id: null, amount: 0 })">{{ $t('transactions.split_add_part') }}</button>
                <span :class="splitSumOk ? 'text-slate-500' : 'text-danger-500 font-medium'">
                  {{ $t('transactions.split_sum') }}: {{ splitSum.toFixed(2) }} / {{ form.amount }}
                </span>
              </div>
            </div>
          </div>
          <div v-if="form.type === 'transfer'">
            <label class="block text-sm font-medium mb-1">{{ $t('transactions.to_account') }}</label>
            <div class="flex gap-2">
              <select v-model="form.transfer_to_account_id" class="flex-1 px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-slate-900 dark:text-slate-100">
                <option v-for="acc in accountsStore.accounts.filter(a => a.id !== form.account_id)" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
              </select>
              <button type="button" class="shrink-0 p-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-primary-600" :title="$t('common.add')" @click="openQuickAccount('transfer_to_account_id')">
                <Icon name="plus" class="w-5 h-5" />
              </button>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium mb-1">{{ $t('transactions.date') }}</label>
              <input v-model="form.date" type="date" required class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0" />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('transactions.note') }}</label>
            <textarea v-model="form.note" class="w-full px-3 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 resize-none h-20" :placeholder="$t('transactions.note_placeholder')"></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ $t('tags.title') }}</label>
            <div class="flex flex-wrap gap-2 mb-2">
              <button
v-for="tag in tagsStore.tags" :key="tag.id" type="button" class="px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
                :class="form.tags.includes(tag.id) ? 'bg-primary-600 text-white border-primary-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'"
                @click="toggleTag(tag.id)">
                {{ tag.name }}
              </button>
            </div>
            <div class="flex gap-2 items-center">
              <input v-model="newTagName" :placeholder="$t('tags.add')" class="flex-1 px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border-0 text-sm" @keyup.enter="addTag" />
              <div class="flex flex-wrap gap-1">
                <button
v-for="color in presetColors" :key="color" type="button" class="w-6 h-6 rounded-full transition-all"
                  :class="newTagColor === color ? 'ring-2 ring-offset-1 dark:ring-offset-slate-900' : ''"
                  :style="{ backgroundColor: color, ringColor: color }"
                  @click="newTagColor = color"></button>
              </div>
              <button type="button" class="px-3 py-2 rounded-full bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700" @click="addTag">{{ $t('common.add') }}</button>
            </div>
          </div>
          <div class="flex gap-3 mt-6">
            <button type="button" class="flex-1 py-2.5 rounded-full border-0 bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800" @click="closeModal">{{ $t('common.cancel') }}</button>
            <button type="submit" class="flex-1 py-2.5 rounded-full bg-primary-500 hover:bg-primary-600 shadow-card text-white text-sm font-medium">{{ $t('common.save') }}</button>
          </div>
        </form>
      </BaseModal>

    <ImportCsvModal v-model="showImportModal" @imported="transactionsStore.fetchTransactions()" />

    <!-- Attachments -->
    <BaseModal v-model="showAttachments" width-class="max-w-md">
      <h2 class="font-display text-xl font-semibold mb-4">{{ $t('transactions.attachments') }}</h2>
      <div class="space-y-3">
        <p v-if="attachmentsLoading" class="text-sm text-slate-500">{{ $t('common.loading') }}</p>
        <template v-else>
          <div v-for="att in attachments" :key="att.id" class="flex items-center justify-between gap-2 p-3 rounded-2xl bg-slate-100 dark:bg-slate-800">
            <a :href="`/api/v1/attachments/${att.id}`" target="_blank" rel="noopener" class="text-sm font-medium truncate flex-1 hover:underline">{{ att.filename }}</a>
            <span class="text-xs text-slate-400 whitespace-nowrap">{{ (att.size / 1024).toFixed(0) }} KB</span>
            <button v-if="!isViewer" class="text-slate-400 hover:text-danger-500" :aria-label="$t('common.delete')" @click="deleteAttachment(att.id)">
              <Icon name="cancel" class="w-4 h-4" />
            </button>
          </div>
          <p v-if="attachments.length === 0" class="text-sm text-slate-500">{{ $t('transactions.attachments_empty') }}</p>
        </template>
        <div v-if="!isViewer" class="flex gap-2">
          <input ref="attachmentInput" type="file" class="hidden" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain" @change="uploadAttachment" />
          <button type="button" :disabled="attachmentUploading" class="flex-1 py-2 rounded-full bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium disabled:opacity-50" @click="attachmentInput?.click()">
            {{ attachmentUploading ? $t('common.loading') : $t('transactions.attachments_upload') }}
          </button>
        </div>
      </div>
    </BaseModal>

    <QuickAccountModal v-model="showQuickAccount" @created="onQuickAccountCreated" />
    <QuickCategoryModal v-model="showQuickCategory" :default-type="form.type" @created="onQuickCategoryCreated" />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, reactive, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTransactionsStore } from '../stores/transactions'
import { useAccountsStore } from '../stores/accounts'
import { useCategoriesStore } from '../stores/categories'
import { useTagsStore } from '../stores/tags'
import { useRatesStore } from '../stores/rates'
import { useAuthStore } from '../stores/auth'
import { useI18n } from 'vue-i18n'
import { useUndo } from '@/composables/useUndo'
import { useHotkeys } from '@/composables/useHotkeys'
import { useTransactionDisplay } from '@/composables/useTransactionDisplay'
import { formatFull } from '@/utils/currency'
import { formatDate as formatDateValue, parseAmount } from '@/utils/format'
import { debounce } from '@/utils/debounce'
import { logger } from '@/utils/logger.js'
import { api } from '@/utils/api'
import ImportCsvModal from '../components/ImportCsvModal.vue'
import QuickAccountModal from '../components/QuickAccountModal.vue'
import QuickCategoryModal from '../components/QuickCategoryModal.vue'
import Icon from '../components/Icon.vue'
import BaseModal from '@/components/BaseModal.vue'
import BaseSkeleton from '@/components/BaseSkeleton.vue'
import { presetColors } from '@/utils/colors'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const ratesStore = useRatesStore()
const baseCurrency = computed(() => ratesStore.baseCurrency)
const undo = useUndo('transactions')

useHotkeys({
  'ctrl+enter': () => { if (showModal.value) saveTransaction() },
  'esc': () => { if (showModal.value) closeModal() }
})


const transactionsStore = useTransactionsStore()
const accountsStore = useAccountsStore()
const categoriesStore = useCategoriesStore()
const tagsStore = useTagsStore()
const authStore = useAuthStore()
const { formatNote, amountClass, categoryClass } = useTransactionDisplay(accountsStore)
const isViewer = computed(() => authStore.user?.role === 'viewer')
const showModal = ref(false)
const showImportModal = ref(false)
const showQuickAccount = ref(false)
const showQuickCategory = ref(false)
const quickAccountTarget = ref('account_id')
const editingId = ref(null)
const filters = reactive({ search: '', account_id: '', category_id: '', type: '', tag_id: '' })
const form = reactive({ type: 'expense', amount: 0, account_id: null, category_id: null, date: new Date().toLocaleDateString('sv-SE'), note: '', transfer_to_account_id: null, tags: [] })
const newTagName = ref('')
const newTagColor = ref('#94a3b8')

// Split-by-category state (create only: splits are managed by delete+recreate)
const useSplits = ref(false)
const splitRows = ref([{ category_id: null, amount: 0 }])
const splitSum = computed(() => splitRows.value.reduce((s, r) => s + (Number(r.amount) || 0), 0))
const splitSumOk = computed(() => Math.abs(splitSum.value - Number(form.amount || 0)) < 0.005)

// Attachments state
const showAttachments = ref(false)
const attachmentsTxId = ref(null)
const attachments = ref([])
const attachmentsLoading = ref(false)
const attachmentInput = ref(null)
const attachmentUploading = ref(false)

// Pagination + request cancellation
const page = ref(1)
const pageSize = 50
const pageCount = computed(() => Math.max(1, Math.ceil(transactionsStore.total / pageSize)))
let fetchController = null


onMounted(() => {
  accountsStore.fetchAccounts()
  categoriesStore.fetchCategories()
  tagsStore.fetchTags()
  ratesStore.fetchRates()
  // Restore filters (and page) from the URL so views are shareable and survive F5
  for (const key of ['search', 'account_id', 'category_id', 'type', 'tag_id']) {
    if (route.query[key] !== undefined) filters[key] = String(route.query[key])
  }
  const urlPage = parseInt(route.query.page, 10)
  if (Number.isFinite(urlPage) && urlPage > 0) page.value = urlPage
  applyFilters(false)
  window.addEventListener('open-transaction-modal', openModal)
})

onUnmounted(() => {
  window.removeEventListener('open-transaction-modal', openModal)
  // Drop in-flight list requests — a slow response must not overwrite the next view's data
  fetchController?.abort()
})

const filteredCategories = computed(() => {
  return categoriesStore.categories.filter(c => c.type === form.type)
})

const selectedAccount = computed(() => {
  return accountsStore.accounts.find(a => a.id === form.account_id)
})

function applyFilters(resetPage = true) {
  if (resetPage) page.value = 1
  fetchPage()
  syncUrl()
}

function fetchPage() {
  // Cancel the previous request: a slow earlier response must not overwrite
  // the results of a newer filter/page change.
  fetchController?.abort()
  fetchController = new AbortController()

  const params = {}
  if (filters.search) params.search = filters.search
  if (filters.account_id) params.account_id = filters.account_id
  if (filters.category_id) params.category_id = filters.category_id
  if (filters.type) params.type = filters.type
  if (filters.tag_id) params.tag_id = filters.tag_id
  params.limit = pageSize
  params.offset = (page.value - 1) * pageSize

  transactionsStore.fetchTransactions(params, fetchController.signal).catch(e => {
    if (e?.name !== 'AbortError') logger.error('Failed to load transactions', e)
  })
}

function syncUrl() {
  const query = {}
  for (const key of ['search', 'account_id', 'category_id', 'type', 'tag_id']) {
    if (filters[key]) query[key] = String(filters[key])
  }
  if (page.value > 1) query.page = String(page.value)
  router.replace({ query })
}

function changePage(newPage) {
  if (newPage < 1 || newPage > pageCount.value) return
  page.value = newPage
  fetchPage()
  syncUrl()
}

const debouncedApplyFilters = debounce(() => applyFilters(), 300)

function resetFilters() {
  filters.search = ''
  filters.account_id = ''
  filters.category_id = ''
  filters.type = ''
  filters.tag_id = ''
  applyFilters()
}function formatDate(date) {
  return formatDateValue(date)
}

function formatAmount(tx) {
  const sign = tx.type === 'income' ? '+' : (tx.type === 'expense' ? '−' : '')
  const full = formatFull(tx.amount, tx.account_currency, baseCurrency.value, ratesStore.rates)
  return `${sign}${full}`
}

function openModal() {
  editingId.value = null
  useSplits.value = false
  splitRows.value = [{ category_id: null, amount: 0 }]
  Object.assign(form, { type: 'expense', amount: 0, account_id: accountsStore.accounts[0]?.id || null, category_id: null, date: new Date().toLocaleDateString('sv-SE'), note: '', transfer_to_account_id: null, tags: [] })
  showModal.value = true
}

function openEditModal(tx) {
  editingId.value = tx.id
  useSplits.value = false
  splitRows.value = [{ category_id: null, amount: 0 }]
  Object.assign(form, {
    type: tx.type,
    amount: parseFloat(tx.amount),
    account_id: tx.account_id,
    category_id: tx.category_id,
    date: String(tx.date).slice(0, 10),
    note: tx.note || '',
    transfer_to_account_id: tx.transfer_to_account_id,
    tags: (tx.tags || []).map(tag => tag.id)
  })
  showModal.value = true
}

function closeModal() {
  showModal.value = false
}

function openQuickAccount(field) {
  quickAccountTarget.value = field
  showQuickAccount.value = true
}

function onQuickAccountCreated(account) {
  form[quickAccountTarget.value] = account.id
}

function onQuickCategoryCreated(category) {
  form.category_id = category.id
}

function toggleTag(tagId) {
  const idx = form.tags.indexOf(tagId)
  if (idx === -1) {
    form.tags.push(tagId)
  } else {
    form.tags.splice(idx, 1)
  }
}

async function addTag() {
  if (!newTagName.value.trim()) return
  const tag = await tagsStore.createTag({ name: newTagName.value.trim(), color: newTagColor.value })
  form.tags.push(tag.id)
  newTagName.value = ''
  newTagColor.value = '#94a3b8'
}

async function saveTransaction() {
  const payload = { ...form, amount: parseAmount(form.amount) }
  if (Number.isNaN(payload.amount)) {
    window.$toast?.error(t('transactions.invalid_amount'))
    return
  }
  if (payload.type !== 'transfer' && useSplits.value) {
    const rows = splitRows.value.map(r => ({ category_id: r.category_id, amount: parseAmount(r.amount) }))
    if (rows.some(r => !r.category_id || !r.amount || Number.isNaN(r.amount))) {
      window.$toast?.error(t('transactions.split_invalid'))
      return
    }
    if (Math.abs(rows.reduce((s, r) => s + r.amount, 0) - payload.amount) > 0.005) {
      window.$toast?.error(t('transactions.split_sum'))
      return
    }
    payload.splits = rows
    payload.category_id = null
  }
  if (editingId.value) {
    await transactionsStore.updateTransaction(editingId.value, payload)
    window.$toast?.success(t('common.saved'))
  } else {
    await transactionsStore.createTransaction(payload)
    window.$toast?.success(t('common.created'))
  }
  closeModal()
  fetchPage()
}

// ---------- Attachments ----------

async function openAttachments(txId) {
  attachmentsTxId.value = txId
  showAttachments.value = true
  attachments.value = []
  attachmentsLoading.value = true
  try {
    attachments.value = await api(`/transactions/${txId}/attachments`)
  } catch (e) {
    logger.error('Failed to load attachments', e)
    window.$toast?.error(e.message || t('common.error'))
  } finally {
    attachmentsLoading.value = false
  }
}

async function uploadAttachment(e) {
  const file = e.target.files?.[0]
  if (!file || !attachmentsTxId.value) return
  attachmentUploading.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)
    await api(`/transactions/${attachmentsTxId.value}/attachments`, { method: 'POST', body: formData })
    attachments.value = await api(`/transactions/${attachmentsTxId.value}/attachments`)
    window.$toast?.success(t('common.saved'))
  } catch (err) {
    logger.error('Attachment upload failed', err)
    window.$toast?.error(err.message || t('common.error'))
  } finally {
    attachmentUploading.value = false
    if (attachmentInput.value) attachmentInput.value.value = ''
  }
}

async function deleteAttachment(id) {
  try {
    await api(`/attachments/${id}`, { method: 'DELETE' })
    attachments.value = attachments.value.filter(a => a.id !== id)
  } catch (e) {
    logger.error('Attachment delete failed', e)
    window.$toast?.error(e.message || t('common.error'))
  }
}

async function deleteTransaction(id) {
  if (!(await window.$confirm({ message: t('common.confirm_delete') }))) return
  const tx = transactionsStore.transactions.find(x => x.id === id)
  await transactionsStore.deleteTransaction(id)
  fetchPage()
  if (tx) {
    undo.push({
      message: t('common.undo_delete'),
      action: async () => {
        await transactionsStore.createTransaction({
          account_id: tx.account_id,
          category_id: tx.category_id,
          amount: tx.amount,
          type: tx.type,
          date: tx.date,
          note: tx.note,
          transfer_to_account_id: tx.transfer_to_account_id
        })
        applyFilters()
      }
    })
  }
}
</script>
