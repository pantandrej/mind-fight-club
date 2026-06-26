-- ============================================================
-- BFC: Demo organizer account for YooKassa verification
-- Run once in Supabase SQL Editor (service role)
--
-- After running:
--   email: demo@brain-fight-club.vercel.app
--   password: set via Supabase Dashboard → Auth → Users → invite/reset
--
-- This creates a demo organizer account that bypasses pending status
-- so YooKassa manager can immediately see the organizer cabinet.
-- ============================================================

-- 1. First create the user in Supabase Auth dashboard manually:
--    Dashboard → Authentication → Users → "Invite user"
--    Email: demo@brain-fight-club.vercel.app
--
-- 2. Then run the rest of this script with the user's UUID:

DO $$
DECLARE
  v_demo_email text := 'demo@brain-fight-club.vercel.app';
  v_user_id    uuid;
BEGIN
  -- Find user by email
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_demo_email;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'User % not found — create in Auth dashboard first', v_demo_email;
    RETURN;
  END IF;

  -- Ensure profile exists
  INSERT INTO profiles (id, display_name, neurons, xp)
  VALUES (v_user_id, 'BFC Demo', 1000, 1000)
  ON CONFLICT (id) DO UPDATE SET display_name = 'BFC Demo';

  -- Give subscription (Premium, so limits screen isn't hit)
  INSERT INTO subscriptions (user_id, plan, status, current_period_end)
  VALUES (v_user_id, 'premium', 'active', now() + interval '1 year')
  ON CONFLICT (user_id) DO UPDATE
    SET plan = 'premium', status = 'active', current_period_end = now() + interval '1 year';

  -- Create approved organizer profile (skips pending/moderation step)
  INSERT INTO organizer_profiles (user_id, display_name, contact_email, city, about, status)
  VALUES (v_user_id, 'BFC Demo Organizer', v_demo_email, 'Москва', 'Демо-аккаунт для проверки платёжного агента', 'approved')
  ON CONFLICT (user_id) DO UPDATE SET status = 'approved', display_name = 'BFC Demo Organizer';

  -- Seed one demo quiz pass so the shop isn't empty
  INSERT INTO quiz_passes (organizer_id, organizer_name, title, description, event_date, location, price, slots_total, slots_left, status)
  VALUES (
    v_user_id,
    'BFC Demo Organizer',
    'Демо-квиз: Мыслибой',
    'Тест-мероприятие для демонстрации. Ответь на 15 вопросов быстрее соперника!',
    now() + interval '7 days',
    'Москва, ул. Арбат, 1',
    300,
    20,
    20,
    'active'
  )
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Demo organizer created for user %', v_user_id;
END $$;
