export type MediaAssetJSON = {
  id: number;
  fileName: string;
  originalName: string;
  storageKey?: string;
  url: string;
  mimeType: string;
  mediaType: "image" | "video";
  fileSize: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  title: string | null;
  uploadedBy: number;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type MediaAssetListQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  type?: "image" | "video";
};

export type MediaAssetListResult = {
  items: MediaAssetJSON[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type PresignMediaAssetUploadInput = {
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
};

export type CompleteMediaAssetUploadInput = {
  uploadToken: string;
  originalFilename: string;
  altText?: string | null;
  title?: string | null;
  width?: number | null;
  height?: number | null;
};

export type UpdateMediaAssetInput = {
  altText?: string | null;
  title?: string | null;
};

export type MediaAssetUsage = {
  usageCount: number;
  productIds: number[];
};
