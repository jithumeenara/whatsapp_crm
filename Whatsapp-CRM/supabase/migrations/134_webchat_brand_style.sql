-- Website Bot: brand colour as solid or gradient, and an animation for the
-- chat button.
--
--   color_style        'solid' | 'gradient'. Default 'gradient' — the button
--                      already drew primary → a darker shade, so existing
--                      widgets look exactly as before.
--   secondary_color    the gradient's second colour (#rrggbb); null means
--                      "a darker shade of the primary", as before.
--   launcher_animation 'none' | 'pulse' | 'bounce' | 'wiggle' | 'float' |
--                      'glow'. Default 'none', so no live website changes
--                      until someone picks one.
--
-- Safe to run again.

ALTER TABLE web_chat_widgets ADD COLUMN IF NOT EXISTS color_style TEXT NOT NULL DEFAULT 'gradient';
ALTER TABLE web_chat_widgets ADD COLUMN IF NOT EXISTS secondary_color TEXT;
ALTER TABLE web_chat_widgets ADD COLUMN IF NOT EXISTS launcher_animation TEXT NOT NULL DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'web_chat_widgets_color_style_check') THEN
    ALTER TABLE web_chat_widgets
      ADD CONSTRAINT web_chat_widgets_color_style_check CHECK (color_style IN ('solid', 'gradient'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'web_chat_widgets_secondary_color_check') THEN
    ALTER TABLE web_chat_widgets
      ADD CONSTRAINT web_chat_widgets_secondary_color_check CHECK (secondary_color IS NULL OR secondary_color ~ '^#[0-9a-f]{6}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'web_chat_widgets_launcher_animation_check') THEN
    ALTER TABLE web_chat_widgets
      ADD CONSTRAINT web_chat_widgets_launcher_animation_check
      CHECK (launcher_animation IN ('none', 'pulse', 'bounce', 'wiggle', 'float', 'glow'));
  END IF;
END $$;
