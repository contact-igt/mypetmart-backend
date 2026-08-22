import type { ContactEnquiryStatus } from "../../constants/database.constants.js";

export const CONTACT_ENQUIRY_SUBJECT_VALUES = ["Product Question", "Order Question", "Something Else"] as const;
export type ContactEnquirySubject = (typeof CONTACT_ENQUIRY_SUBJECT_VALUES)[number];

export type CreateContactEnquiryInput = {
  name: string;
  email: string;
  phone?: string | null | undefined;
  subject: ContactEnquirySubject;
  orderNumber?: string | null | undefined;
  message: string;
};

export type StorefrontContactEnquiryResultJSON = {
  success: true;
  enquiryNumber: string;
};

export type AdminContactEnquiryItem = {
  id: number;
  enquiryNumber: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string;
  orderNumber: string | null;
  message: string;
  status: ContactEnquiryStatus;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminContactEnquiryDetail = AdminContactEnquiryItem;

export type UpdateContactEnquiryInput = {
  status?: ContactEnquiryStatus | undefined;
  adminNote?: string | null | undefined;
};

export type ListAdminContactEnquiriesQuery = {
  page?: number | undefined;
  pageSize?: number | undefined;
  search?: string | undefined;
  status?: ContactEnquiryStatus | undefined;
};
