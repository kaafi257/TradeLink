import { supabase } from "./supabase";

/** Applies a coupon to a request that was just sent. Never throws: the request itself already went through. */
export async function applyCoupon(quoteNumber: string, phone: string, code: string): Promise<string> {
  const c = code.trim();
  if (!c || !supabase || !/^QTN-/.test(quoteNumber) || quoteNumber === "QTN-RECEIVED") return "";
  const { error } = await supabase.rpc("apply_coupon", { p_quote_number: quoteNumber, p_phone: phone, p_code: c });
  if (error) return `Your request was sent, but the coupon was not applied: ${error.message}`;
  return `Coupon ${c.toUpperCase()} applied. The discount comes off your price when we quote it.`;
}
