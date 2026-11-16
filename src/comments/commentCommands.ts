import * as vscode from "vscode";
import { NovelCommentController } from "./novelCommentController";

export function submitComment(controller: NovelCommentController, reply: vscode.CommentReply): Promise<void> {
  return controller.submitComment(reply);
}

export function toggleCommentResolved(controller: NovelCommentController, thread: vscode.CommentThread): void {
  controller.toggleResolved(thread);
}

export function deleteCommentThread(controller: NovelCommentController, thread: vscode.CommentThread): void {
  controller.deleteThread(thread);
}
