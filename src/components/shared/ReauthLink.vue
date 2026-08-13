<script setup lang="ts">
import { computed } from "vue";
import { useAuth } from "../../auth";
import { API } from "../../api";

// >>> Drop-in for any "your stored Twitch token is missing scope X, re-authorize
// >>> to fix it" prompt. Re-auth only makes sense for the real broadcaster's own
// >>> Twitch consent - an admin god-moded into someone else's channel clicking
// >>> the link would authorize under the ADMIN's own account instead, silently
// >>> doing nothing for the channel that's actually missing the scope. So this
// >>> renders the link only on your own channel, and inert text otherwise.
const { session } = useAuth();
const isOwnChannel = computed(
  () => !!session.value && session.value.login === session.value.channel,
);

withDefaults(defineProps<{ fallback?: string }>(), {
  fallback: "the broadcaster needs to re-authorize",
});
</script>

<template>
  <a v-if="isOwnChannel" :href="`${API}/auth/add`" class="reauth-link"><slot /></a>
  <template v-else>{{ fallback }}</template>
</template>

<style scoped>
.reauth-link {
  color: #e5c07b;
  font-weight: 700;
  text-decoration: underline;
}
</style>
