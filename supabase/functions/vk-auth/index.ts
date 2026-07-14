import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { access_token, user_id, first_name, last_name, avatar } = await req.json()
    if (!access_token || !user_id) {
      return new Response(JSON.stringify({ error: 'Missing access_token or user_id' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    // Verify VK token by calling VK ID user info endpoint
    const vkResp = await fetch('https://id.vk.com/oauth2/user_info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=54679210&access_token=${encodeURIComponent(access_token)}`,
    })
    const vkData = await vkResp.json()

    if (!vkData.user || String(vkData.user.user_id) !== String(user_id)) {
      return new Response(JSON.stringify({ error: 'VK token invalid' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    const vkUser = vkData.user
    const displayName = [first_name || vkUser.first_name, last_name || vkUser.last_name].filter(Boolean).join(' ') || `VK${user_id}`
    const avatarUrl = avatar || vkUser.avatar || null
    const email = vkUser.email || `vk${user_id}@brainfight.club`

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Find or create user
    const { data: { users }, error: listErr } = await sb.auth.admin.listUsers({ perPage: 1000 })
    if (listErr) throw listErr

    let targetUser = users?.find(u =>
      u.user_metadata?.vk_id === String(user_id) ||
      (u.email === email && !email.endsWith('@brainfight.club'))
    )

    if (targetUser) {
      // Update metadata
      await sb.auth.admin.updateUserById(targetUser.id, {
        user_metadata: {
          ...targetUser.user_metadata,
          vk_id: String(user_id),
          full_name: displayName,
          avatar_url: avatarUrl,
        }
      })
    } else {
      // Create new user
      const { data: created, error: createErr } = await sb.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          vk_id: String(user_id),
          full_name: displayName,
          avatar_url: avatarUrl,
          provider: 'vk',
        },
      })
      if (createErr) {
        // Email conflict — find by email
        targetUser = users?.find(u => u.email === email)
        if (!targetUser) throw createErr
      } else {
        targetUser = created.user!
      }
    }

    // Generate a sign-in token (no email sent)
    const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
      type: 'magiclink',
      email: targetUser.email!,
      options: { redirectTo: 'https://brainfight.club/' }
    })
    if (linkErr) throw linkErr

    return new Response(JSON.stringify({
      token_hash: linkData.properties.hashed_token,
      email: targetUser.email,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })

  } catch (e) {
    console.error('vk-auth error:', e)
    return new Response(JSON.stringify({ error: e.message || 'Internal error' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
