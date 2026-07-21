import { Schema } from "effect";
import { MessageId, NonNegativeInt, TrimmedNonEmptyString } from "../baseSchemas";
import {
  CHAT_ASSISTANT_SELECTION_TEXT_MAX_CHARS,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "./protocol";

const PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS = 14_000_000;
const PROVIDER_SEND_TURN_MAX_FILE_DATA_URL_CHARS = 35_000_000;
const CHAT_ATTACHMENT_ID_MAX_CHARS = 128;

const ChatAttachmentId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CHAT_ATTACHMENT_ID_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9_-]+$/i),
);
export type ChatAttachmentId = typeof ChatAttachmentId.Type;

export const ChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
});
export type ChatImageAttachment = typeof ChatImageAttachment.Type;

export const ChatFileAttachment = Schema.Struct({
  type: Schema.Literal("file"),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_FILE_BYTES)),
});
export type ChatFileAttachment = typeof ChatFileAttachment.Type;

export const ChatAssistantSelectionAttachment = Schema.Struct({
  type: Schema.Literal("assistant-selection"),
  id: ChatAttachmentId,
  assistantMessageId: MessageId,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(CHAT_ASSISTANT_SELECTION_TEXT_MAX_CHARS)),
});
export type ChatAssistantSelectionAttachment = typeof ChatAssistantSelectionAttachment.Type;

const UploadChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS),
  ),
});
export type UploadChatImageAttachment = typeof UploadChatImageAttachment.Type;

export const UploadChatFileAttachment = Schema.Struct({
  type: Schema.Literal("file"),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_FILE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_FILE_DATA_URL_CHARS),
  ),
});
export type UploadChatFileAttachment = typeof UploadChatFileAttachment.Type;

export const UploadChatAssistantSelectionAttachment = Schema.Struct({
  type: Schema.Literal("assistant-selection"),
  assistantMessageId: MessageId,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(CHAT_ASSISTANT_SELECTION_TEXT_MAX_CHARS)),
});
export type UploadChatAssistantSelectionAttachment =
  typeof UploadChatAssistantSelectionAttachment.Type;

export const ChatAttachment = Schema.Union([
  ChatImageAttachment,
  ChatFileAttachment,
  ChatAssistantSelectionAttachment,
]);
export type ChatAttachment = typeof ChatAttachment.Type;
export const ChatAttachmentList = Schema.Array(ChatAttachment).check(
  Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS),
);
const UploadChatAttachment = Schema.Union([
  UploadChatImageAttachment,
  UploadChatFileAttachment,
  UploadChatAssistantSelectionAttachment,
]);
export type UploadChatAttachment = typeof UploadChatAttachment.Type;
export const UploadChatAttachmentList = Schema.Array(UploadChatAttachment).check(
  Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS),
);
