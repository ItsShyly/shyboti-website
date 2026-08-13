<script setup lang="ts">
import { computed } from "vue";
import { useAuth } from "../../auth";
import { API } from "../../api";

// >>> admin mode would re-auth as the admin's own account, not the broadcaster - only render the link on your own channel
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
