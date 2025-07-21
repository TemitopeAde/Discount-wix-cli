import express from 'express';
import cors from 'cors';
import { createClient, AppStrategy } from '@wix/sdk';
import { customTriggers } from '@wix/ecom/service-plugins';
import jwt from 'jsonwebtoken';
import { members } from '@wix/members';
import { orders, plans, plansV3 } from '@wix/pricing-plans';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const availableTriggers = [
  {
    id: "paid-plan-discount",
    name: "Customer with Active Paid Plan"
  }
];

// 🔐 Middleware to parse raw JWTs sent as text/plain
const parseTextPlainJwt = (req, res, next) => {
  if (req.is('text/plain')) {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      try {
        const decoded = jwt.decode(raw, { complete: false });
        req.body = decoded;
      } catch (e) {
        console.error("❌ Failed to decode JWT:", e);
        req.body = {};
      }
      next();
    });
  } else {
    next();
  }
};

// ✅ Factory to get a wixClient with proper instanceId
function getWixClient(instanceId) {
  return createClient({
    auth: AppStrategy({
      appId: "0a3fffa5-066c-4fc3-b7af-7138928b62c1",
      appSecret: "38d3af28-c418-498e-87d9-4b3f25e3b380",
      instanceId
    }),
    modules: {
      customTriggers,
      orders,
      members: {
        members
      }
    }
  });
}

// 🔍 Custom Triggers Handler Registration
customTriggers.provideHandlers({
  listTriggers: async ({ metadata }) => {
    console.log("📋 LIST TRIGGERS called", { instanceId: metadata.instanceId });
    return { customTriggers: availableTriggers };
  },

  getEligibleTriggers: async ({ request, metadata }) => {
    const eligibleTriggers = [];
    const { memberId } = metadata.identity || {};
    const instanceId = metadata.instanceId;

    const wixClient = getWixClient(instanceId);

    for (const trigger of request.triggers || []) {
      const id = trigger.customTrigger?.id;
      const identifier = trigger.identifier;

      let isEligible = false;

      if (id === 'paid-plan-discount' && memberId) {
        try {
          const plansResponse = await wixClient.members.membership.listMemberships({ memberId });
          const activePlans = plansResponse.memberships?.filter(p => p.status === 'ACTIVE');
          isEligible = activePlans.length > 0;
        } catch (err) {
          console.error("Error checking membership:", err);
        }
      }

      if (isEligible) {
        eligibleTriggers.push({
          customTriggerId: id,
          identifier
        });
      }
    }

    return { eligibleTriggers };
  }
});

// 🧪 Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'Custom Discount Triggers',
    triggers: availableTriggers.length,
    timestamp: new Date().toISOString()
  });
});

// 🧪 Manual Trigger List Test
app.post("/v1/list-triggers", (req, res) => {
  res.status(200).json({ customTriggers: availableTriggers });
});

// 🧪 Manual Eligible Trigger Test
app.post("/v1/get-eligible-triggers", parseTextPlainJwt, async (req, res) => {
  const request = req.body?.data?.request;
  const metadata = req.body?.data?.metadata;

  if (!request || !metadata) {
    return res.status(400).json({ error: "Invalid body format" });
  }

  const instanceId = metadata.instanceId;
  const memberId = metadata.identity?.memberId;
  const wixClient = getWixClient(instanceId);

  const eligibleTriggers = [];

  for (const trigger of request.triggers || []) {
    const id = trigger.customTrigger?.id;
    const identifier = trigger.identifier;

    let isEligible = false;

    if (id === 'paid-plan-discount' && memberId) {
      try {
        const plansResponse = await wixClient.members.membership.listMemberships({ memberId });
        const activePlans = plansResponse.memberships?.filter(p => p.status === 'ACTIVE');
        isEligible = activePlans.length > 0;
      } catch (err) {
        console.error("Error checking membership:", err);
      }
    }

    if (isEligible) {
      eligibleTriggers.push({ customTriggerId: id, identifier });
    }
  }

  res.status(200).json({ eligibleTriggers });
});

// 🧩 Handle official Wix request routing
app.post('/plugins-and-webhooks/*', (req, res) => {
  console.log(`🔄 Processing Wix request: ${req.method} ${req.path}`);
  console.log('Headers:', Object.keys(req.headers));
  try {
    customTriggers.process(req, res);
  } catch (error) {
    console.error('❌ Error processing request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 🔚 Catch-all
app.all('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: 'Service plugin endpoint is POST /plugins-and-webhooks/*'
  });
});

// 🚀 Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🚀 Custom Discount Triggers Service Plugin Started');
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`🔗 Health: http://localhost:${PORT}/health`);
});
