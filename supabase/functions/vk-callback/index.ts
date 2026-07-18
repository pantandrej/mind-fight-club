import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VK_APP_ID = '54683964'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { code, redirect_uri } = await req.json()
    if (!code) {
      return new Response(JSON.stringify({ error: 'Missing code' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    const clientSecret = Deno.env.get('VK_CLIENT_SECRET')!
    const redirectUri  = redirect_uri || 'https://brain-fight-club.vercel.app/'

    const tokenUrl = 'https://oauth.vk.com/access_token?' + new URLSearchParams({
      client_id:     VK_APP_ID,
      client_secret: clientSecret,
      redirect_uri:  redirectUri,
      code,
    })
    const tokenResp = await fetch(tokenUrl)
    const tokenText = await tokenResp.text()
    console.log('VK token:', tokenText.slice(0, 400))

    const tokenData = JSON.parse(tokenText)
    if (tokenData.error) throw new Error(`VK: ${tokenData.error} — ${tokenData.error_description}`)

    const access_token = tokenData.access_token as string
    const vk_user_id   = String(tokenData.user_id)
    const email        = (tokenData.email as string) || null

    const apiResp = await fetch(
      `https://api.vk.com/method/users.get?fields=photo_200&access_token=${access_token}&v=5.131&user_ids=${vk_user_id}`
    )
    const apiJson     = await apiResp.json()
    const u           = apiJson.response?.[0] || {}
    const displayName = [u.first_name, u.last_name].filter(Boolean).join(' ') || `VK${vk_user_id}`
    const avatarUrl   = u.photo_200 || null
    const userEmail   = email || `vk${vk_user_id}@brainfight.club`

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data: { users } } = await sb.auth.admin.listUsers({ perPage: 1000 })
    let targetUser = users?.find(u => u.user_metadata?.vk_id === vk_user_id)

    if (targetUser) {
      await sb.auth.admin.updateUserById(targetUser.id, {
        user_metadata: { ...targetUser.user_metadata, vk_id: vk_user_id, full_name: displayName, avatar_url: avatarUrl }
      })
    } else {
      const { data: created, error: createErr } = await sb.auth.admin.createUser({
        email: userEmail, email_confirm: true,
        user_metadata: { vk_id: vk_user_id, full_name: displayName, avatar_url: avatarUrl, provider: 'vk' },
      })
      if (createErr) {
        targetUser = users?.find(u => u.email === userEmail)
        if (!targetUser) throw createErr
      } else {
        targetUser = created.user!
      }
    }

    const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
      type: 'magiclink',
      email: targetUser!.email!,
      options: { redirectTo: 'https://brain-fight-club.vercel.app/' }
    })
    if (linkErr) throw linkErr

    return new Response(JSON.stringify({
      token_hash: linkData.properties.hashed_token,
      email: targetUser!.email,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })

  } catch (e) {
    console.error('vk-callback error:', e)
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
