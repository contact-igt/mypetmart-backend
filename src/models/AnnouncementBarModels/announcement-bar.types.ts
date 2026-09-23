export type AdminAnnouncementBarItem = {
  id: number;
  message: string;
  linkUrl: string | null;
  linkLabel: string | null;
  active: boolean;
  displayOrder: number;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StorefrontAnnouncementBarItem = {
  id: number;
  message: string;
  linkUrl: string | null;
  linkLabel: string | null;
};

export type CreateAnnouncementBarItemInput = {
  message: string;
  linkUrl?: string | null | undefined;
  linkLabel?: string | null | undefined;
  active?: boolean | undefined;
  displayOrder?: number | undefined;
  startsAt?: string | null | undefined;
  endsAt?: string | null | undefined;
};

export type UpdateAnnouncementBarItemInput = {
  message?: string | undefined;
  linkUrl?: string | null | undefined;
  linkLabel?: string | null | undefined;
  active?: boolean | undefined;
  startsAt?: string | null | undefined;
  endsAt?: string | null | undefined;
};

export type ReorderAnnouncementBarItem = {
  itemId: number;
  displayOrder: number;
};

export type AnnouncementBarReorderInput = {
  items: ReorderAnnouncementBarItem[];
};
