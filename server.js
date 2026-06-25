require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// Initialize Express app
const app = express();

// Initialize Supabase Client directly
const supabaseUrl = 'https://azizdmyketrbekkxrxbc.supabase.co';
const supabaseKey = 'sb_publishable_ppEXdyQN17_xvBDxEA1Ejg_vAebBG_p';

// Create the connection
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware to parse incoming request data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static UI files out of your 'public' directory
app.use(express.static(path.join(__dirname, 'public')));


// --- 1. EXISTING USER REGS & AUTH ROUTING ---

app.post('/api/register', async (req, res) => {
    console.log("📥 [SERVER] Received data from form:", req.body);
    const { fullName, username, mobileNumber, password } = req.body;

    if (!username || !password || !mobileNumber) {
        return res.status(400).json({ error: "Missing required registration details." });
    }

    try {
        const { data, error } = await supabase
            .from('profiles')
            .insert([
                { 
                    full_name: fullName, 
                    username: username, 
                    mobile: mobileNumber, 
                    password_hash: password,
                    active_tiers: [] 
                }
            ])
            .select();

        if (error) throw error;
        
        // 🟢 FIX: Handing back clean JSON data so your frontend async script doesn't crash
        return res.status(200).json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('username', username)
            .single();

        if (error || !data || data.password_hash !== password) {
            return res.status(401).json({ error: "Invalid username or password credentials." });
        }
        return res.status(200).json({ success: true, username: data.username });
    } catch (err) {
        return res.status(500).json({ error: "User authentication check failed." });
    }
});


// --- 2. NEW USER DASHBOARD INTERACTION ROUTING ---

app.get('/api/user/status/:username', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('username, full_name, active_tiers')
            .eq('username', req.params.username)
            .single();

        if (error || !data) return res.status(404).json({ error: "User profile not found." });
        return res.status(200).json(data);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/user/request-tier', async (req, res) => {
    const { username, planId, amount } = req.body;
    if (!username || !planId || !amount) {
        return res.status(400).json({ error: "Missing investment payload metrics." });
    }

    try {
        const { data, error } = await supabase
            .from('tier_requests')
            .insert([{ username, plan_id: parseInt(planId), amount: parseInt(amount), status: 'pending' }]);

        if (error) throw error;
        return res.status(200).json({ success: true, message: "Verification request submitted to Admin successfully!" });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});


// --- 3. DYNAMIC INVESTMENT PLANS ROUTES ---

// Fetch all active plans from the database (For both Users and Admin)
app.get('/api/plans', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('investment_plans')
            .select('*')
            .order('raw_deposit_value', { ascending: true }); 
            
        if (error) throw error;
        return res.status(200).json(data);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Admin Route: Add a new Plan to the database
app.post('/api/admin/plans', async (req, res) => {
    const { deposit, withdraw, duration, interest, raw_deposit_value } = req.body;
    try {
        const { data, error } = await supabase
            .from('investment_plans')
            .insert([{ deposit, withdraw, duration, interest, raw_deposit_value: parseInt(raw_deposit_value) }])
            .select();
            
        if (error) throw error;
        return res.status(200).json({ success: true, plan: data[0] });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Admin Route: Delete a Plan
app.delete('/api/admin/plans/:id', async (req, res) => {
    try {
        const { error } = await supabase
            .from('investment_plans')
            .delete()
            .eq('id', req.params.id);
            
        if (error) throw error;
        return res.status(200).json({ success: true, message: `Plan ${req.params.id} deleted successfully.` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});


// --- 4. ADMINISTRATIVE DASHBOARD OPERATIONS ---

app.get('/api/admin/pending', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('tier_requests')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return res.status(200).json(data);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('username, full_name, active_tiers');

        if (error) throw error;
        return res.status(200).json(data);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/approve', async (req, res) => {
    const { requestId, username, planId } = req.body;
    try {
        const { error: requestErr } = await supabase
            .from('tier_requests')
            .update({ status: 'approved' })
            .eq('id', requestId);

        if (requestErr) throw requestErr;

        const { data: userProfile, error: fetchErr } = await supabase
            .from('profiles')
            .select('active_tiers')
            .eq('username', username)
            .single();

        if (fetchErr) throw fetchErr;

        let tiers = userProfile.active_tiers || [];
        if (!tiers.includes(parseInt(planId))) {
            tiers.push(parseInt(planId));
        }

        const { error: updateErr } = await supabase
            .from('profiles')
            .update({ active_tiers: tiers })
            .eq('username', username);

        if (updateErr) throw updateErr;

        return res.status(200).json({ success: true, message: "Tier successfully authorized and activated." });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/reject', async (req, res) => {
    const { requestId } = req.body;
    try {
        const { error } = await supabase
            .from('tier_requests')
            .update({ status: 'rejected' })
            .eq('id', requestId);

        if (error) throw error;
        return res.status(200).json({ success: true, message: "Request successfully turned down." });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/wipe', async (req, res) => {
    const { username } = req.body;
    try {
        const { error } = await supabase
            .from('profiles')
            .update({ active_tiers: [] })
            .eq('username', username);

        if (error) throw error;
        return res.status(200).json({ success: true, message: "User investment matrix reset cleanly." });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/toggle-tier', async (req, res) => {
    const { username, planId, isActivated } = req.body;
    try {
        const { data: userProfile, error: fetchErr } = await supabase
            .from('profiles')
            .select('active_tiers')
            .eq('username', username)
            .single();

        if (fetchErr) throw fetchErr;

        let tiers = userProfile.active_tiers || [];
        const planIdInt = parseInt(planId);

        if (isActivated) {
            if (!tiers.includes(planIdInt)) tiers.push(planIdInt);
        } else {
            tiers = tiers.filter(id => id !== planIdInt);
        }

        const { error: updateErr } = await supabase
            .from('profiles')
            .update({ active_tiers: tiers })
            .eq('username', username);

        if (updateErr) throw updateErr;

        return res.status(200).json({ success: true, updatedTiers: tiers });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});


// --- 5. STATIC SITE REDIRECTS & VIEWS ---

// Route to serve the dashboard webpage layout
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Root route: Automatically redirect visitors to the login page
app.get('/', (req, res) => {
    res.redirect('/login.html');
});


// --- 6. EXPORTS & RUNNERS (Always keep at the absolute end!) ---

// Export the application layer for Vercel Serverless engine integration
module.exports = app;

// Local development runner
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Backend live and listening on http://localhost:${PORT}`));