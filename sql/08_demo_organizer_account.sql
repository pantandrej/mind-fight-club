-- ============================================================
-- BFC: Demo organizer account for YooKassa verification
-- Run once in Supabase SQL Editor (service role)
-- ============================================================

-- Step 1: Add missing columns to quiz_passes (DDL must be outside DO block)
ALTER TABLE quiz_passes ADD COLUMN IF NOT EXISTS event_date timestamptz;
ALTER TABLE quiz_passes ADD COLUMN IF NOT EXISTS date_text  text;
ALTER TABLE quiz_passes ADD COLUMN IF NOT EXISTS location   text;
ALTER TABLE quiz_passes ADD COLUMN IF NOT EXISTS city       text;

-- Step 2: Create demo account data
DO $$
DECLARE
  v_demo_email text := 'demo@brain-fight-club.vercel.app';
  v_user_id    uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_demo_email;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'User % not found — create in Auth dashboard first', v_demo_email;
    RETURN;
  END IF;

  -- Profile
  INSERT INTO profiles (id, display_name, neurons, xp)
  VALUES (v_user_id, 'BFC Demo', 1000, 1000)
  ON CONFLICT (id) DO UPDATE SET display_name = 'BFC Demo';

  -- Premium subscription
  INSERT INTO subscriptions (user_id, plan, status, current_period_end)
  VALUES (v_user_id, 'premium', 'active', now() + interval '1 year')
  ON CONFLICT (user_id) DO UPDATE
    SET plan = 'premium', status = 'active', current_period_end = now() + interval '1 year';

  -- Approved organizer profile
  INSERT INTO organizer_profiles (user_id, display_name, contact_email, city, about, status)
  VALUES (v_user_id, 'BFC Demo Organizer', v_demo_email, 'Москва', 'Демо-аккаунт для проверки платёжного агента', 'approved')
  ON CONFLICT (user_id) DO UPDATE SET status = 'approved', display_name = 'BFC Demo Organizer';

  -- Demo quiz pass
  INSERT INTO quiz_passes (organizer_id, organizer_name, title, description, date_text, city, price, slots_total, slots_left, status)
  VALUES (
    v_user_id,
    'BFC Demo Organizer',
    'Демо-квиз: Мыслибой',
    'Тест-мероприятие для демонстрации. Ответь на 15 вопросов быстрее соперника!',
    '5 июля 2025, 19:00',
    'Москва',
    300,
    20,
    20,
    'active'
  )
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Demo organizer created for user %', v_user_id;
END $$;
