/** The issuer printed on every document, from Settings › Invoice details (F2). */
import { getInvoiceSettings } from '../db/invoices';
import { getTutorProfile } from '../db/tutorProfile';
import type { DocumentBrand } from './documentHtml';

export function loadDocumentBrand(): DocumentBrand {
  let s: ReturnType<typeof getInvoiceSettings> | null = null;
  try {
    s = getInvoiceSettings();
  } catch {
    s = null;
  }
  const tutor = getTutorProfile()?.full_name?.trim() || null;
  return {
    logoDataUri: s?.logo_data_uri ?? null,
    name: s?.business_name ?? tutor,
    regNo: s?.business_reg_no ?? null,
    phone: s?.business_phone ?? null,
    email: s?.business_email ?? null,
    address: s?.business_address ?? null,
  };
}
