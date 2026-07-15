import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const VK_APP_ID = '54679210'
const VK_CLIENT_SECRET = Deno.env.get('VK_CLIENT_SECRET')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { code, redirect_uri } = await req.json()
    if (!code || !redirect_uri) {
      return new Response(JSON.stringify({ error: 'Missing code or redirect_uri' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    // Exchange code for access_token via VK OAuth2
    const tokenUrl = `https://oauth.vk.com/access_token?` +
      `client_id=${VK_APP_ID}` +
      `&client_secret=${encodeURIComponent(VK_CLIENT_SECRET)}` +
      `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
      `&code=${encodeURIComponent(code)}`

    const tokenResp = await fetch(tokenUrl)
    const tokenData = await tokenResp.json()

    if (tokenData.error) {
      return new Response(JSON.stringify({ error: tokenData.error_description || tokenData.error }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    const { access_token, user_id, email: vkEmail } = tokenData

    // Get user info from VK API
    const userResp = await fetch(
      `https://api.vk.com/method/users.get?user_ids=${user_id}&fields=photo_200&access_token=${access_token}&v=5.199`
    )
    const userData = await userResp.json()
    const vkUser = userData.response?.[0] || {}

    const displayName = [vkUser.first_name, vkUser.last_name].filter(Boolean).join(' ') || `VK${user_id}`
    const avatarUrl = vkUser.photo_200 || null
    const email = vkEmail || `vk${user_id}@brainfight.club`

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
      await sb.auth.admin.updateUserById(targetUser.id, {
        user_metadata: {
          ...targetUser.user_metadata,
          vk_id: String(user_id),
          full_name: displayName,
          avatar_url: avatarUrl,
        }
      })
    } else {
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
        targetUser = users?.find(u => u.email === email)
        if (!targetUser) throw createErr
      } else {
        targetUser = created.user!
      }
    }

    const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
      type: 'magiclink',
      email: targetUser!.email!,
      options: { redirectTo: 'https://brainfight.club/' }
    })
    if (linkErr) throw linkErr

    return new Response(JSON.stringify({
      token_hash: linkData.properties.hashed_token,
      email: targetUser!.email,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })

  } catch (e) {
    console.error('vk-auth error:', e)
    return new Response(JSON.stringify({ error: e.message || 'Internal error' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
