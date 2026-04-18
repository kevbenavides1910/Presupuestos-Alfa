-- Add PENDING_RETURN value to AssetStatus enum.
-- A previous asset assigned to a position automatically transitions to this state
-- when a new asset of the same type is assigned to the same position.
ALTER TYPE "AssetStatus" ADD VALUE IF NOT EXISTS 'PENDING_RETURN';
