import type {
  ForgeComment,
  ForgeCommentRequest,
  ForgeChangedFile,
  ForgeItem,
  ForgeItemDetail,
  ForgeItemList,
  ForgeItemRequest,
  ForgeLabel,
  ForgeListQuery,
  ForgeMergeRequest,
  ForgeNewIssueRequest,
  ForgePage,
  ForgePageRequest,
  ForgeStateRequest,
} from "@zcode/shared";

export interface ForgeProviderAdapter {
  listItems(request: ForgeListQuery): Promise<ForgeItemList>;
  getItem(request: ForgeItemRequest): Promise<ForgeItemDetail>;
  listComments(request: ForgePageRequest): Promise<ForgePage<ForgeComment>>;
  listFiles(request: ForgePageRequest): Promise<ForgePage<ForgeChangedFile>>;
  listLabels(): Promise<ForgeLabel[]>;
  createIssue(request: ForgeNewIssueRequest): Promise<ForgeItem>;
  createComment(request: ForgeCommentRequest): Promise<void>;
  setState(request: ForgeStateRequest): Promise<void>;
  merge(request: ForgeMergeRequest): Promise<void>;
}
