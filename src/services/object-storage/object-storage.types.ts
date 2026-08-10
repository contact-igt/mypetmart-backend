export type PresignedPutRequest = {
  key: string;
  contentType: string;
  expiresInSeconds: number;
};

export type PresignedPutResult = {
  uploadUrl: string;
};

export type StoredObjectMetadata = {
  key: string;
  contentType: string | undefined;
  sizeBytes: number | undefined;
  lastModified: Date | undefined;
};

export type ListedStoredObject = {
  key: string;
  lastModified: Date | undefined;
};

export interface ObjectStorageProvider {
  createPresignedPut(request: PresignedPutRequest): Promise<PresignedPutResult>;
  headObject(key: string): Promise<StoredObjectMetadata | null>;
  deleteObject(key: string): Promise<void>;
  listObjects(prefix: string): Promise<ListedStoredObject[]>;
}

export type ProductImageUploadAuthorization = {
  uploadUrl: string;
  method: "PUT";
  requiredHeaders: Readonly<Record<string, string>>;
  r2Key: string;
  publicUrl: string;
  expiresAt: string;
  uploadToken: string;
};

export type VerifiedProductImageUpload = {
  r2Key: string;
  publicUrl: string;
  contentType: string;
  sizeBytes: number;
};
