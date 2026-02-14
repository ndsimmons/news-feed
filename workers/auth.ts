// Auth API - Magic Link Authentication
// Handles sending magic links and verifying tokens

interface Env {
  DB: D1Database;
  RESEND_API_KEY: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (url.pathname === '/api/auth/send-magic-link' && request.method === 'POST') {
        return await handleSendMagicLink(request, env);
      }

      if (url.pathname === '/api/auth/verify' && request.method === 'POST') {
        return await handleVerifyToken(request, env);
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error) {
      console.error('Auth API Error:', error);
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

/**
 * Send a magic link to the user's email
 */
async function handleSendMagicLink(request: Request, env: Env): Promise<Response> {
  const { email } = await request.json() as { email: string };

  if (!email || !email.includes('@')) {
    return new Response(JSON.stringify({ error: 'Invalid email' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Generate secure random token
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  // Store token in database
  await env.DB.prepare(`
    INSERT INTO magic_links (email, token, expires_at)
    VALUES (?, ?, ?)
  `).bind(email, token, expiresAt.toISOString()).run();

  // Create or get user
  let user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  
  if (!user) {
    const result = await env.DB.prepare(`
      INSERT INTO users (email) VALUES (?)
    `).bind(email).run();
    
    // Also initialize interest weights for new user
    const userId = result.meta.last_row_id;
    await env.DB.prepare(`
      INSERT INTO interest_weights (user_id, category_id, source_id, weight)
      SELECT ?, id, NULL, 1.0 FROM categories
      UNION ALL
      SELECT ?, NULL, id, 1.0 FROM sources
    `).bind(userId, userId).run();
  }

  // Send email via Resend
  const magicLink = `https://nicofeed.com/?token=${token}`;
  
  try {
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Nicofeed <login@nicofeed.com>',
        to: [email],
        subject: '🐔 Your Nicofeed Magic Link',
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #2563eb;">Welcome to Nicofeed!</h1>
            <p>Click the button below to sign in and start personalizing your news feed:</p>
            <div style="margin: 30px 0;">
              <a href="${magicLink}" 
                 style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                Sign in to Nicofeed
              </a>
            </div>
            <p style="color: #666; font-size: 14px;">This link expires in 15 minutes.</p>
            <p style="color: #999; font-size: 12px;">If you didn't request this email, you can safely ignore it.</p>
          </div>
        `
      })
    });

    if (!emailResponse.ok) {
      console.error('Resend API error:', await emailResponse.text());
      throw new Error('Failed to send email');
    }
  } catch (error) {
    console.error('Error sending email:', error);
    return new Response(JSON.stringify({ error: 'Failed to send email' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

/**
 * Verify a magic link token and return user session
 */
async function handleVerifyToken(request: Request, env: Env): Promise<Response> {
  const { token } = await request.json() as { token: string };

  if (!token) {
    return new Response(JSON.stringify({ error: 'Token required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Check if token exists and is valid
  const magicLink = await env.DB.prepare(`
    SELECT * FROM magic_links 
    WHERE token = ? AND used = 0 AND expires_at > datetime('now')
  `).bind(token).first();

  if (!magicLink) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Mark token as used
  await env.DB.prepare('UPDATE magic_links SET used = 1 WHERE token = ?').bind(token).run();

  // Get user
  const user = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?')
    .bind(magicLink.email as string)
    .first();

  if (!user) {
    return new Response(JSON.stringify({ error: 'User not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ 
    success: true, 
    user: {
      id: user.id,
      email: user.email
    },
    token // Return the same token to use as session token
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
