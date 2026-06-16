const MERCHANT_ID   = process.env.EXPRESSPAY_MERCHANT_ID ?? "";
const API_KEY       = process.env.EXPRESSPAY_API_KEY     ?? "";
const SANDBOX       = process.env.EXPRESSPAY_SANDBOX === "true";
const BASE          = SANDBOX
  ? "https://sandbox.expresspaygh.com/api"
  : "https://expresspaygh.com/api";
const CHECKOUT_HOST = SANDBOX
  ? "https://sandbox.expresspaygh.com"
  : "https://expresspaygh.com";

export function isExpressPayConfigured(): boolean {
  return Boolean(MERCHANT_ID && API_KEY);
}

export function checkoutUrl(token: string): string {
  return `${CHECKOUT_HOST}/payment?token=${encodeURIComponent(token)}`;
}

async function epPost<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new Error(`ExpressPay ${path} HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export interface SubmitResponse {
  status:      number;   // 1=Success 2=Invalid Creds 3=Invalid Request 4=Invalid IP
  token?:      string;
  message?:    string;
  "order-id"?: string;
}

export async function submitPayment(opts: {
  firstname:   string;
  lastname:    string;
  email:       string;
  amount:      number;
  orderId:     string;
  redirectUrl: string;
  postUrl:     string;
}): Promise<SubmitResponse> {
  return epPost<SubmitResponse>("/submit.php", {
    "merchant-id":  MERCHANT_ID,
    "api-key":      API_KEY,
    firstname:      opts.firstname,
    lastname:       opts.lastname,
    email:          opts.email,
    username:       opts.email,
    phonenumber:    "",
    currency:       "GHS",
    amount:         opts.amount.toFixed(2),
    "order-id":     opts.orderId,
    "order-desc":   "SkyVult Wallet Deposit",
    "redirect-url": opts.redirectUrl,
    "post-url":     opts.postUrl,
  });
}

export interface QueryResponse {
  result:             number;   // 1=Approved 2=Declined 3=Error 4=Pending
  "result-text":      string;
  "order-id":         string;
  token?:             string;
  "transaction-id"?:  string;
  currency?:          string;
  amount?:            number;
}

export async function queryPayment(token: string): Promise<QueryResponse> {
  return epPost<QueryResponse>("/query.php", {
    "merchant-id": MERCHANT_ID,
    "api-key":     API_KEY,
    token,
  });
}
