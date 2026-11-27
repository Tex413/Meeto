---
title: How do I send action items to Microsoft To Do?
product: Meeteor
version: 2.1.0
tags: [tasks, microsoft, integration]
applies_to: To Do button in the To-dos panel
---

## Short answer
Connect with your own Microsoft app client ID, choose a list, select **Send tasks**, and then check the list in Microsoft To Do.

## Steps
1. Select **To Do** in the To-dos heading.
2. Follow the on-screen registration steps in the Azure portal: personal Microsoft accounts, the **Mobile and desktop** redirect address shown, and the delegated **Tasks.ReadWrite** permission.
3. Paste the **Application (client) ID** and select **Save & sign in**.
4. Go to `microsoft.com/devicelogin`, enter the code shown and sign in.
5. Choose a list and select **Send tasks**. Only open items are sent.
6. Check Microsoft To Do. The app's sent count does not confirm that each task was accepted, and sending again creates duplicates.
7. To disconnect, open the panel while you have an open item and select **Disconnect**. The client ID stays saved.
