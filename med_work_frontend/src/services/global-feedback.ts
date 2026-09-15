export type FeedbackListener = (error: Error) => void;

let feedbackListener: FeedbackListener | null = null;

export function setFeedbackListener(listener: FeedbackListener | null) {
  feedbackListener = listener;
}

export function showGlobalError(error: Error) {
  feedbackListener?.(error);
}
