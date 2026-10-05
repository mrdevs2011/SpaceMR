-- Reply (Telegram-style) support for DM and group messages
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to uuid REFERENCES public.messages(id) ON DELETE SET NULL;

ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS reply_to uuid REFERENCES public.group_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS messages_reply_to_idx ON public.messages (reply_to) WHERE reply_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS group_messages_reply_to_idx ON public.group_messages (reply_to) WHERE reply_to IS NOT NULL;

COMMENT ON COLUMN public.messages.reply_to IS 'Parent message id this message is replying to (Telegram-style quote)';
COMMENT ON COLUMN public.group_messages.reply_to IS 'Parent message id this message is replying to (Telegram-style quote)';
