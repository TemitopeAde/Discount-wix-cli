import express from 'express';
import cors from 'cors';
import { createClient, AppStrategy } from '@wix/sdk';
import { customTriggers } from '@wix/ecom/service-plugins';
import jwt from 'jsonwebtoken';
import { members } from '@wix/members';
import { orders } from '@wix/pricing-plans';


const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.send('Hello World!');
});

const wixClient = createClient({
  auth: AppStrategy({
    appId: "0a3fffa5-066c-4fc3-b7af-7138928b62c1",

    publicKey: `-----BEGIN PUBLIC KEY-----
  MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiCmHJHomL1g7SWvgd9tu
  CKy/WXMAmemd2RfzR+6M4VD76OPswZwofQZPQ8ShMMLJ86MfpWQMIwNZu07F3Waw
  +3bWbuZBXspHcAaFMuZq8xTegDS8CSExOgTCjYV/uAJV1YQYfVQTLKFJ4bdlg7lu
  oLreUy/lq5zzHols8jZF64PVVEhsi1IPoqBgp3VPqMr+Zn2DODSJpslRcne7Q0FD
  mlRS3dGyEGPf7J0Jn/VD6GvSohwWCZcivxfnAIgoCEZUicqLGMrqG29hz/5TWWAj
  XhDDwZS8EgYkKQ+3coG87DVLOXRP1CI8t+8x80xYn+fM1VVyG/u/SiyLLYV4qJiQ
  7QIDAQAB
  -----END PUBLIC KEY-----`
  }),
  modules: {
    customTriggers,
    members: {
      members
    }
  }
});

const availableTriggers = [
  {
    id: "paid-plan-discount",
    name: "Customer with Active Paid Plan"
  }
]

const parseTextPlainJwt = (req, res, next) => {
  if (req.is('text/plain')) {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      try {
        // 🔐 Decode the JWT without verifying (for now)
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

async function listOrders() {
  try {
    const options = {
      limit: 50, 
      sorting: {
        fieldName: "createdDate", 
        order: "DESC" 
      }
    };

    const ordersList = await orders.managementListOrders(options);
    console.log(ordersList); 
    return ordersList;
  } catch (error) {
    console.error("Error retrieving orders:", error);
  }
}


wixClient.customTriggers.provideHandlers({
  listTriggers: async (payload) => {
    try {
      const { metadata } = payload;
      console.log("📋 LIST TRIGGERS called");
      console.log("Request ID:", metadata.requestId);
      console.log("Instance ID:", metadata.instanceId);

      return { customTriggers: availableTriggers };
    } catch (error) {
      console.error("❌ Error in listTriggers:", error);
      throw error;
    }
  },

  getEligibleTriggers: async ({ request, metadata }) => {
    const eligibleTriggers = [];

    for (const triggerToCheck of request.triggers || []) {
      const customTrigger = triggerToCheck.customTrigger;
      const identifier = triggerToCheck.identifier;

      let isEligible = false;

      switch (customTrigger._id) {
        case 'paid-plan-discount':
          const memberId = metadata.identity?.memberId;
          if (memberId) {
            try {
              const plansResponse = await wixClient.members.membership.listMemberships({ memberId });
              const activePlans = plansResponse.memberships?.filter(plan => plan.status === 'ACTIVE');
              isEligible = activePlans.length > 0;
            } catch (error) {
              console.error("Error checking paid plan:", error);
            }
          }
          break;
      }

      if (isEligible) {
        eligibleTriggers.push({
          customTriggerId: customTrigger._id,
          identifier
        });
      }
    }

    return { eligibleTriggers };
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'Custom Discount Triggers',
    triggers: availableTriggers.length,
    timestamp: new Date().toISOString()
  });
});

app.post("/v1/list-triggers", (req, res) => {
  try {
    res.status(200).json({
      customTriggers: [
        {
          id: "paid-plan-discount",
          name: "Customer with Active Paid Plan"
        }
      ]
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/v1/get-eligible-triggers", parseTextPlainJwt, async (req, res) => {
  const request = req.body?.data?.request;
  const metadata = req.body?.data?.metadata;
  const eligibleTriggers = [];


  async function getMemberOrder(orderId) {
    try {
      const order = await orders.memberGetOrder(orderId, { fieldSet: 'FULL' });
      console.log(order);
      return order;
    } catch (error) {
      console.error(error);
    }
  }


  if (!request || !metadata) {
    return res.status(400).json({ error: "Invalid body format" });
  }

  for (const trigger of request.triggers || []) {
    const id = trigger.customTrigger?.id;
    const identifier = trigger.identifier;
    let isEligible = false;



    if (id === 'paid-plan-discount') {
      const memberId = metadata?.identity?.memberId;
      const res = await listOrders(memberId);
      console.log({ res });

      if (memberId) {
        try {
          // const plansResponses = await wixClient
          // const plansResponse = await wixClient.members.membership.listMemberships({ memberId });
          // const activePlans = plansResponse.memberships?.filter(p => p.status === 'ACTIVE');
          // isEligible = activePlans.length > 0;
        } catch (err) {
          console.error("Error checking membership:", err);
        }
      }
    }

    if (isEligible) {
      eligibleTriggers.push({
        customTriggerId: id,
        identifier
      });
    }
  }

  res.status(200).json({ eligibleTriggers });
});



app.post('/plugins-and-webhooks/*', (req, res) => {
  console.log(`🔄 Processing Wix request: ${req.method} ${req.path}`);
  console.log('Headers:', Object.keys(req.headers));

  try {
    wixClient.process(req, res);
  } catch (error) {
    console.error('❌ Error processing request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.all('*', (req, res) => {
  console.log(`🚫 Unhandled: ${req.method} ${req.path}`);
  res.status(404).json({
    error: 'Not found',
    message: 'Service plugin endpoint is POST /plugins-and-webhooks/*'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🚀 Custom Discount Triggers Service Plugin Started');
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`🔗 Health: http://localhost:${PORT}/health`);
  console.log(`🎯 Wix Endpoint: POST http://localhost:${PORT}/plugins-and-webhooks/*`);
  console.log('\n📋 Available Triggers:');
  availableTriggers.forEach(trigger => {
    console.log(`  - ${trigger.name} (ID: ${trigger._id})`);
  });
});

export default app;
