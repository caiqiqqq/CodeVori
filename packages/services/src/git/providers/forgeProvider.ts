import type {
  ForgeComment,
  ForgeCommentRequest,
  ForgeChangedFile,
  ForgeItem,
  ForgeItemDetail,
  ForgeItemExtras,
  ForgeItemList,
  ForgeItemRequest,
  ForgeLabel,
  ForgeListQuery,
  ForgeMergeRequest,
  ForgeNewIssueRequest,
  ForgeUpdateIssueRequest,
  ForgePage,
  ForgePageRequest,
  ForgeStateRequest,
  ForgeImageRequest,
  ForgeImagePreview,
  ForgeIssueOptions,
  ForgeImageUploadRequest,
  ForgeImageUploadResult,
} from "@zcode/shared";

export interface ForgeProviderAdapter {
  uploadImage?(request: ForgeImageUploadRequest): Promise<ForgeImageUploadResult>;
  listItems(request: ForgeListQuery): Promise<ForgeItemList>;
  getItem(request: ForgeItemRequest): Promise<ForgeItemDetail>;
  getItemExtras?(request: ForgeItemRequest): Promise<ForgeItemExtras>;
  readImage?(request: ForgeImageRequest): Promise<ForgeImagePreview>;
  authenticateImage?(request: ForgeImageRequest): Promise<void>;
  listComments(request: ForgePageRequest): Promise<ForgePage<ForgeComment>>;
  listFiles(request: ForgePageRequest): Promise<ForgePage<ForgeChangedFile>>;
  listLabels(): Promise<ForgeLabel[]>;
  getIssueOptions(): Promise<ForgeIssueOptions>;
  createIssue(request: ForgeNewIssueRequest): Promise<ForgeItem>;
  updateIssue(request: ForgeUpdateIssueRequest): Promise<ForgeItem>;
  createComment(request: ForgeCommentRequest): Promise<void>;
  setState(request: ForgeStateRequest): Promise<void>;
  merge(request: ForgeMergeRequest): Promise<void>;
}
