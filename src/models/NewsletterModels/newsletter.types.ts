import type { NewsletterSubscriberStatus } from "../../constants/database.constants.js";

export type NewsletterSubscribeInput = {
  email: string;
  source?: string | undefined;
};

export type NewsletterSubscribeResult = {
  message: string;
};

export type NewsletterVerifyResult = {
  message: string;
  email: string;
  unsubscribeToken: string;
};

export type NewsletterUnsubscribeResult = {
  message: string;
};

export type NewsletterResendUnsubscribeLinkResult = {
  message: string;
};

export type AdminNewsletterSubscriberJSON = {
  id: number;
  email: string;
  status: NewsletterSubscriberStatus;
  source: string | null;
  verifiedAt: string | null;
  unsubscribedAt: string | null;
  createdAt: string;
};

export type ListNewsletterSubscribersQuery = {
  page?: number;
  limit?: number;
  status?: NewsletterSubscriberStatus | undefined;
  search?: string | undefined;
};

export type NewsletterSubscriberListResponse = {
  items: AdminNewsletterSubscriberJSON[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
  };
};
