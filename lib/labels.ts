export const PURCHASE_METHOD_LABELS = { store: "店頭", visit: "出張", delivery: "宅配", other: "その他" } as const;
export const PAYMENT_METHOD_LABELS = { cash: "現金", bank_transfer: "振込", other: "その他" } as const;
export const CONDITION_LABELS = { new: "新品・未使用", S: "S", A: "A", B: "B", C: "C", D: "D", junk: "ジャンク" } as const;
export const CHANNEL_LABELS = { store: "店舗販売", dealer: "業者販売", auction: "オークション", ec: "EC・フリマ", other: "その他" } as const;
export const ITEM_STATUS_LABELS = {
  in_stock: "在庫",
  partially_sold: "一部販売",
  sold: "販売済",
  split: "分割済",
  voided: "取消",
} as const;
export const PAYMENT_STATUS_LABELS = { unpaid: "未入金", partial: "一部入金", paid: "入金済" } as const;
export const EXPENSE_TYPE_LABELS = { fee: "販売手数料", shipping: "送料", other: "その他直接経費" } as const;
export const FUND_TX_LABELS = {
  opening: "初期残高",
  replenish: "資金補充",
  purchase_payment: "買取支出",
  purchase_refund: "買取返金",
  return_to_company: "資金返却",
  transfer: "従業員間移動",
  approved_adjustment: "承認済み調整",
} as const;
export const APPROVAL_TYPE_LABELS = {
  fund_adjustment: "資金調整",
  fund_replenish: "資金補充",
  fund_transfer: "従業員間移動",
  purchase_void: "買取取消",
  sale_cancel: "販売キャンセル",
} as const;
export const APPROVAL_STATUS_LABELS = { pending: "承認待ち", approved: "承認済", rejected: "却下", withdrawn: "取下げ" } as const;
export const ACCOUNT_KIND_LABELS = { staff_reserve: "従業員準備金", company_cash: "本社現金", company_bank: "本社口座" } as const;
