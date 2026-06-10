export type Mode = "tracker" | "monthly-plan" | "zero";
export type View =
  | "home"
  | "setup"
  | "spaces"
  | "plan"
  | "add"
  | "ai"
  | "receipts"
  | "movements"
  | "accounts"
  | "rules"
  | "review"
  | "networth"
  | "debts"
  | "goals"
  | "reports"
  | "family"
  | "export"
  | "account"
  | "settings"
  | "import"
  | "paywall"
  | "receipt-capture";

export type GroupKey = "income" | "essentials" | "discretionary" | "debt" | "savings" | "investments";
export type TransactionType = "income" | "expense" | "transfer" | "debt_payment" | "saving" | "investment" | "refund";
export type CurrencyCode = "DOP" | "USD" | "MXN" | "EUR";
export type RecurringFrequency = "weekly" | "biweekly" | "monthly" | "yearly";
export type SubscriptionPlan = "free" | "pro";
export type NotificationKind = "daily_capture" | "recurring" | "budget_risk" | "month_close" | "balance_confirm" | "debt_payment" | "goal_progress" | "movement_review" | "receipts";
export type AiProvider = "local" | "openai" | "byok" | "claude" | "openrouter";

export interface Category {
  id: string;
  group: GroupKey;
  name: string;
  subcategories: string[];
  plannedCents: number;
  source?: "starter" | "user" | "imported";
  archived?: boolean;
}

export interface MonthlyCategoryPlan {
  id: string;
  month: string;
  categoryId: string;
  plannedCents: number;
  rolloverCents?: number;
  notes?: string;
}

export interface Account {
  id: string;
  name: string;
  kind: "cash" | "bank" | "credit" | "savings" | "investment";
  balanceCents: number;
  currency?: CurrencyCode;
  archived?: boolean;
  defaultForCapture?: boolean;
  includeInNetWorth?: boolean;
  confirmedBalanceCents?: number;
  lastConfirmedAt?: string;
  notes?: string;
}

// A single line of a receipt/factura (e.g. "Leche x2 = RD$120"). amountCents is the
// line TOTAL (quantity already factored in), so the rows sum to the transaction amount.
// Optional + additive on Transaction: movements captured without itemization stay valid.
export interface LineItem {
  name: string;
  quantity: number;
  amountCents: number;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  date: string;
  description: string;
  categoryId: string;
  subcategory?: string;
  accountId: string;
  transferAccountId?: string;
  linkedTransactionId?: string;
  linkKind?: "refund" | "card_payment" | "correction";
  merchant?: string;
  person?: string;
  tags: string[];
  note?: string;
  originalAmountCents: number;
  originalCurrency: CurrencyCode;
  amountCents: number;
  baseCurrency: CurrencyCode;
  exchangeRate: number;
  exchangeRateDate: string;
  exchangeRateSource: "api" | "manual" | "same_currency";
  status: "approved" | "needs_review" | "duplicate" | "adjustment";
  createdBy: string;
  attachmentNames?: string[];
  // Itemized receipt lines parsed from a factura. Optional + additive: round-tripped by
  // convex-adapter both directions (serialize -> snapshot payload -> deserialize).
  lineItems?: LineItem[];
  splits?: TransactionSplit[];
  audit?: MovementAuditEvent[];
}

export interface ReceiptAttachment {
  id: string;
  fileName: string;
  contentType: string;
  source: "receipt" | "invoice" | "statement" | "other";
  status: "uploaded" | "processing" | "needs_review" | "confirmed" | "error";
  createdAt: string;
  transactionId?: string;
  amountCents?: number;
  currency?: CurrencyCode;
  date?: string;
  merchant?: string;
  extractedText?: string;
  note?: string;
  // Pointer to the real uploaded file in Convex _storage. Optional so local-only/manual
  // receipts (no uploaded bytes) stay valid; round-tripped by convex-adapter both directions.
  storageId?: string;
}

// A reference to a real uploaded file. Threaded from receipt-capture through addTransaction
// so the created ReceiptAttachment can carry its storageId (the file pointer that must survive
// autosave). storageId/contentType are optional for the manual path (filename-only attachments).
export interface AttachmentRef {
  fileName: string;
  storageId?: string;
  contentType?: string;
  // Set by uploadAttachment after registerReceipt; lets the capture/review UI
  // re-run AI parse and fetch a signed preview URL for the just-uploaded file.
  attachmentId?: string;
}

// The canonical input every capture source (manual form, AI text, receipt vision) maps to
// before calling addTransaction (the single Transaction writer). Lifted here from the monolith
// so the pure lib helpers (capture-input.ts) can produce it without importing the monolith.
export interface NewTransactionInput {
  type: TransactionType;
  date: string;
  amount: string;
  currency: CurrencyCode;
  exchangeRate: number;
  exchangeRateDate: string;
  exchangeRateSource: "api" | "manual" | "same_currency";
  accountId: string;
  transferAccountId: string;
  linkedTransactionId: string;
  linkKind?: "refund" | "card_payment" | "correction";
  categoryId: string;
  subcategory: string;
  description: string;
  merchant: string;
  tags: string;
  note: string;
  needsReview: boolean;
  attachmentNames: string[];
  // Real uploaded files {fileName, storageId, contentType}. Optional + additive: the manual
  // path keeps using attachmentNames; receipt capture also passes attachmentRefs so the created
  // ReceiptAttachment carries storageId.
  attachmentRefs?: AttachmentRef[];
  // Itemized receipt lines (factura) captured alongside the movement. Optional + additive:
  // the manual/text paths omit it; receipt capture passes parsed lines straight to addTransaction.
  lineItems?: LineItem[];
  afterSaveView?: View;
}

export interface TransactionSplit {
  id: string;
  categoryId: string;
  subcategory?: string;
  amountCents: number;
  note?: string;
}

export interface MovementAuditEvent {
  id: string;
  at: string;
  by: string;
  action: "created" | "edited" | "split_added" | "reviewed" | "duplicated" | "rule_created" | "recurring_created";
  summary: string;
}

export interface FamilyComment {
  id: string;
  targetType: "transaction" | "category";
  targetId: string;
  authorMemberId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface ReviewItem {
  id: string;
  reason: "uncategorized" | "duplicate" | "balance_adjustment" | "ai_suggestion" | "receipt_pending" | "budget_risk" | "recurring_pending" | "account_unconfirmed";
  title: string;
  subtitle: string;
  amountCents: number;
  action: string;
  targetType?: "transaction" | "receipt" | "account" | "category" | "rule";
  targetId?: string;
}

export interface RecurringRule {
  id: string;
  name: string;
  type: TransactionType;
  categoryId: string;
  accountId: string;
  amountCents: number;
  currency: CurrencyCode;
  frequency: RecurringFrequency;
  nextDate: string;
  merchant?: string;
  note?: string;
  active: boolean;
}

export interface AutomationRule {
  id: string;
  name: string;
  matchText: string;
  categoryId: string;
  accountId?: string;
  merchant?: string;
  subcategory?: string;
  tag?: string;
  active: boolean;
}

export interface RuleApplication {
  id: string;
  ruleId: string;
  ruleName: string;
  kind: "recurring" | "automation";
  transactionId?: string;
  transactionDescription?: string;
  summary: string;
  status: "created_pending" | "classified" | "skipped";
  createdAt: string;
}

export interface Goal {
  id: string;
  name: string;
  targetCents: number;
  savedCents: number;
  due: string;
  accountId?: string;
  priority?: "low" | "medium" | "high";
  archived?: boolean;
}

export interface Debt {
  id: string;
  name: string;
  balanceCents: number;
  originalBalanceCents?: number;
  rate: number;
  minimumCents: number;
  strategy: "snowball" | "avalanche" | "manual";
}

export interface NetWorthItem {
  id: string;
  name: string;
  kind: "asset" | "liability";
  group: "cash" | "bank" | "investment" | "property" | "debt" | "other";
  amountCents: number;
}

export interface Member {
  id: string;
  name: string;
  role: "owner" | "editor" | "viewer";
  avatar: string;
  email?: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar: string;
  locale: string;
  timezone: string;
  status: "signed_out" | "signed_in";
  provider: "local" | "convex_auth";
  currentMemberId: string;
  createdAt: string;
  lastLoginAt?: string;
}

export interface FinancialSpace {
  id: string;
  name: string;
  kind: "personal" | "family" | "business" | "test";
  currency: CurrencyCode;
  activeMonth: string;
  role: "owner" | "editor" | "viewer";
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
}

export interface SubscriptionState {
  plan: SubscriptionPlan;
  aiCreditsUsed: number;
  aiCreditsLimit: number;
  storageMbUsed: number;
  storageMbLimit: number;
  spacesLimit: number;
  membersLimit: number;
  // Read-only display provenance hydrated from the server subscriptions row (adapter-defaulted).
  // The client never authors these — only setHouseholdPlan on the server writes them.
  proSource?: "stub_checkout" | "manual_grant" | "none";
  proGrantedAt?: number;
}

export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  saveHistory: boolean;
  allowReceiptText: boolean;
}

export interface AiAction {
  id: string;
  kind: "text_capture" | "receipt_parse" | "monthly_summary" | "budget_suggestion";
  provider: AiProvider;
  status: "suggested" | "accepted" | "failed";
  inputPreview: string;
  outputSummary: string;
  creditsUsed: number;
  createdAt: string;
}

export interface MonthClosing {
  id: string;
  month: string;
  incomeCents: number;
  outflowCents: number;
  remainderCents: number;
  savingsRate: number;
  netWorthCents: number;
  closedAt: string;
  pendingReviewCount?: number;
  pendingReceiptCount?: number;
  confirmedAccountIds?: string[];
  exceededCategories?: Array<{
    categoryId: string;
    name: string;
    plannedCents: number;
    spentCents: number;
    overCents: number;
  }>;
  suggestedAdjustments?: Array<{
    categoryId: string;
    name: string;
    currentPlannedCents: number;
    suggestedPlannedCents: number;
    reason: string;
  }>;
  learning?: string;
  nextMonthPrepared?: boolean;
  notes?: string;
}

export interface AppState {
  user: UserProfile;
  activeSpaceId: string;
  spaces: FinancialSpace[];
  subscription: SubscriptionState;
  householdName: string;
  currency: CurrencyCode;
  activeMonth: string;
  mode: Mode;
  categories: Category[];
  monthlyPlans: MonthlyCategoryPlan[];
  accounts: Account[];
  transactions: Transaction[];
  receipts: ReceiptAttachment[];
  comments: FamilyComment[];
  review: ReviewItem[];
  recurringRules: RecurringRule[];
  automationRules: AutomationRule[];
  ruleApplications: RuleApplication[];
  goals: Goal[];
  debts: Debt[];
  netWorth: NetWorthItem[];
  members: Member[];
  aiSettings: AiSettings;
  aiActions: AiAction[];
  notificationSettings: Record<NotificationKind, boolean>;
  monthClosings: MonthClosing[];
  // Per-household merchant normalization rules: map a raw OCR/bank merchant string to a
  // clean display alias. Optional + additive; synced on the household doc and round-tripped
  // by convex-adapter both directions.
  merchantAliases?: { raw: string; alias: string }[];
}
