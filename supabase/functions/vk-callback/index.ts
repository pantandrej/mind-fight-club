import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VK_APP_ID = '54679210'
const APP_URL   = 'https://brain-fight-club.vercel.app'

Deno.serve(async (req) => {
  const url    = new URL(req.url)
  const code   = url.searchParams.get('code')
  const errParam = url.searchParams.get('error')

  if (errParam) {
    return Response.redirect(`${APP_URL}/?vk_error=${encodeURIComponent(errParam)}`, 302)
  }

  if (!code) {
    return Response.redirect(`${APP_URL}/?vk_error=no_code`, 302)
  }

  try {
    const clientSecret  = Deno.env.get('VK_CLIENT_SECRET')!
    const redirectUri   = `${Deno.env.get('SUPABASE_URL')}/functions/v1/vk-callback`

    // Classic VK Web OAuth — server-side code exchange
    const tokenUrl = `https://oauth.vk.com/access_token?` + new URLSearchParams({
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

    // Get user name + photo
    const apiResp = await fetch(
      `https://api.vk.com/method/users.get?fields=photo_200&access_token=${access_token}&v=5.131&user_ids=${vk_user_id}`
    )
    const apiJson  = await apiResp.json()
    const u        = apiJson.response?.[0] || {}
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
      options: { redirectTo: APP_URL + '/' }
    })
    if (linkErr) throw linkErr

    const tokenHash = linkData.properties.hashed_token
    return Response.redirect(`${APP_URL}/?vk_hash=${tokenHash}`, 302)

  } catch (e) {
    console.error('vk-callback error:', e)
    return Response.redirect(`${APP_URL}/?vk_error=${encodeURIComponent(String(e?.message || e))}`, 302)
  }
})
