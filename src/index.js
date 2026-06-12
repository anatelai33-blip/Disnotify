import { Client, GatewayIntentBits, Events, EmbedBuilder } from 'discord.js';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import logger from './logger/winston.js';
import OpenAI from 'openai';
import cron from 'node-cron';

dotenv.config();

const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

// Raid detection tracking
const joinHistory = new Map(); // serverId -> [timestamps]

function detectRaid(serverId) {
  const now = Date.now();
  const window = 5 * 60 * 1000; // 5 minutes
  
  if (!joinHistory.has(serverId)) {
    joinHistory.set(serverId, [now]);
    return false;
  }
  
  const timestamps = joinHistory.get(serverId).filter(t => t > now - window);
  timestamps.push(now);
  joinHistory.set(serverId, timestamps);
  
  return timestamps.length >= 5;
}

async function getAINotification(username, serverName, memberCount) {
  if (!process.env.OPENAI_API_KEY) return null;
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "user",
          content: `Summarize: ${username} joined ${serverName}. Member count: ${memberCount}. Generate short DM (max 100 chars)`
        }
      ],
      max_tokens: 50,
    });
    return response.choices[0].message.content.trim();
  } catch (error) {
    logger.error(`OpenAI Error: ${error.message}`);
    return null;
  }
}

async function sendJoinNotification(member, serverName) {
  const adminIds = process.env.ADMIN_USER_IDS.split(',').map(id => id.trim());
  const isRaid = detectRaid(member.guild.id);
  
  const aiMessage = await getAINotification(member.user.username, serverName, member.guild.memberCount);
  const finalMessage = aiMessage || `**${member.user.username}** has joined **${serverName}**`;
  
  const embed = new EmbedBuilder()
    .setColor(isRaid ? 0xFF0000 : 0x2B2D42)
    .setTitle(isRaid ? '⚠️ POTENTIAL RAID DETECTED' : '🔔 New Member Joined')
    .setDescription(finalMessage)
    .addFields(
      { name: 'User ID', value: member.user.id, inline: true },
      { name: 'Server Member Count', value: `${member.guild.memberCount}`, inline: true },
      { name: 'Joined At', value: new Date().toLocaleString(), inline: false }
    )
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp()
    .setFooter({ text: 'Disnotify Pro • AI-Powered Monitoring' });

  let successCount = 0;
  
  for (const adminId of adminIds) {
    try {
      const admin = await client.users.fetch(adminId);
      if (admin) {
        await admin.send({ embeds: [embed] });
        logger.info(`DM sent to admin ${adminId} for ${member.user.username}`);
        successCount++;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      logger.error(`Failed to DM admin ${adminId}: ${error.message}`);
    }
  }
  
  try {
    await prisma.joinEvent.create({
      data: {
        userId: member.user.id,
        username: member.user.username,
        serverId: member.guild.id,
        serverName: serverName,
        notified: successCount > 0
      }
    });
  } catch (dbError) {
    logger.error(`Failed to log join event: ${dbError.message}`);
  }
  
  return successCount;
}

// Daily Summary Task (Runs at 11:59 PM)
cron.schedule('59 23 * * *', async () => {
  logger.info('Running daily summary...');
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  
  try {
    const dailyJoins = await prisma.joinEvent.count({
      where: { joinedAt: { gte: startOfDay } }
    });
    
    const adminIds = process.env.ADMIN_USER_IDS.split(',').map(id => id.trim());
    const summaryEmbed = new EmbedBuilder()
      .setColor(0x00AE86)
      .setTitle('📊 Daily Join Summary')
      .setDescription(`Today, a total of **${dailyJoins}** members joined across all monitored servers.`)
      .setTimestamp();
      
    for (const adminId of adminIds) {
      try {
        const admin = await client.users.fetch(adminId);
        if (admin) await admin.send({ embeds: [summaryEmbed] });
      } catch (err) {
        logger.error(`Failed to send summary to ${adminId}: ${err.message}`);
      }
    }
  } catch (error) {
    logger.error(`Daily Summary Error: ${error.message}`);
  }
});

client.once(Events.ClientReady, async () => {
  logger.info(`✅ Logged in as ${client.user.tag}`);
  await prisma.$connect();
  logger.info('Database connected');
});

client.on(Events.GuildMemberAdd, async (member) => {
  const serverName = member.guild.name;
  try {
    await sendJoinNotification(member, serverName);
  } catch (error) {
    logger.error(`Error handling member join: ${error.message}`);
  }
});

client.login(process.env.DISCORD_TOKEN);
