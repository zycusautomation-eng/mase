"use client";
// Shared drawer-open state for the Deals route, in its own module so the layout (provider),
// DealsBoard (opener) and UrlDealDrawer (host) can all use it without a circular import.
// `openId` is the deal whose drawer is open — set instantly on row click from the in-memory
// slim record, so the panel renders on the next frame instead of waiting on an RSC navigation.
import { createContext, useContext } from "react";

export type DrawerCtl = { openId: string | null; open: (id: string) => void; close: () => void };

export const DrawerCtx = createContext<DrawerCtl>({ openId: null, open: () => {}, close: () => {} });

export const useDealDrawer = () => useContext(DrawerCtx);
