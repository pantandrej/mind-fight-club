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
    const { code, redirect_uri, code_verifier } = await req.json()
    if (!code || !redirect_uri) {
      return new Response(JSON.stringify({ error: 'Missing code or redirect_uri' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    // Exchange code for access_token via VK ID OAuth2 (PKCE)
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: VK_APP_ID,
      client_secret: VK_CLIENT_SECRET,
      redirect_uri,
      code,
      ...(code_verifier ? { code_verifier } : {}),
    })
    const tokenResp = await fetch('https://id.vk.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
    })
    const tokenData = await tokenResp.json()

    if (tokenData.error) {
      return new Response(JSON.stringify({ error: tokenData.error_description || tokenData.error }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    const { access_token } = tokenData

    // Get user info from VK ID
    const userResp = await fetch('https://id.vk.com/oauth2/user_info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${VK_APP_ID}&access_token=${encodeURIComponent(access_token)}`,
    })
    const userData = await userResp.json()
    const vkUser = userData.user || {}
    const user_id = vkUser.user_id
    const vkEmail = vkUser.email

    const displayName = [vkUser.first_name, vkUser.last_name].filter(Boolean).join(' ') || `VK${user_id}`
    const avatarUrl = vkUser.avatar || null
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
      options: { redirectTo: 'https://mind-fight-club.vercel.app/' }
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
